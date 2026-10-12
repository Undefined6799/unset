// P1.30: the strict Compose subset the preflight reads (architecture record 2026-10-07-p130-preflight-location-and-yaml):
// anything Compose could read differently from us is refused rather than guessed.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { networksOf, ParseError, parseCompose, parseEnvFile, refuseAliasesByOption } from "./compose-parse.ts";
import { loadCompose } from "./index.ts";

describe("compose subset", () => {
  const refused = (yaml: string) => expect(() => parseCompose(yaml, "c.yaml")).toThrow();
  const base = "name: unset-prod\nservices:\n  edge:\n    image: x\n";

  test("preflight_accepts_the_subset", () => {
    const compose = parseCompose(
      `${base}    ports: ["127.0.0.1:2019:2019"]\n    environment: [A=1, B=$$x]\n`,
      "c.yaml",
    );
    expect(compose.services).toMatchObject([
      { name: "edge", ports: [{ hostIp: "127.0.0.1", published: "2019", target: "2019" }] },
    ]);
  });
  test("preflight_refuses_anchor_alias_merge", () => {
    refused(`${base}    environment: &e\n      A: "1"\n  pds:\n    environment: *e\n`);
    refused(`${base}  pds:\n    <<: {image: y}\n`);
  });
  // The second layer behind the walk (docs/ai/book/phase-1.md, P1.30; book edit 2026-10-07-p130p-as-built).
  test("parser_sets_max_alias_count_zero", () => {
    refused(`${base}    environment: &e\n      A: "1"\n  pds:\n    image: y\n    environment: *e\n`);
    // With the walk skipped, the option alone still refuses the alias, naming the file.
    const [aliased] = parseAllDocuments(`a: &x 1\nb: *x\n`);
    expect(() => aliased && refuseAliasesByOption(aliased, "c.yaml")).toThrow(ParseError);
    expect(() => aliased && refuseAliasesByOption(aliased, "c.yaml")).toThrow(/^c\.yaml: alias/);
    const [plain] = parseAllDocuments(base);
    expect(() => plain && refuseAliasesByOption(plain, "c.yaml")).not.toThrow();
  });
  test("preflight_refuses_tags", () => refused(`${base}    user: !!str "1000"\n`));
  test("preflight_refuses_multi_document", () => refused(`${base}---\n${base}`));
  test("preflight_refuses_duplicate_keys", () => refused(`${base}    image: y\n`));
  test("preflight_refuses_include_and_extends", () => {
    refused(`include: [other.yaml]\n${base}`);
    refused(`${base}  pds:\n    extends: edge\n`);
  });
  test("preflight_refuses_interpolation_in_security_fields", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    for (const field of ["image: ${IMG}", "user: ${U}", 'ports: ["${P}:80"]', "env_file: ${F}", "privileged: ${P}"]) {
      refused(`name: unset-prod\nservices:\n  edge:\n    ${field}\n`);
    }
    // P1.30w (record 2026-10-12-c18-follow-ups, ruling N7): through the keys the parser reads, the $ refusal itself
    // answers; `privileged` above still stops at the key allowlist first (`user` is read from P1.30x).
    const dollar = (field: string) => () =>
      parseCompose(`name: unset-prod\nservices:\n  edge:\n    ${field}\n`, "c.yaml");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    const throughAllowedKeys: [string, string][] = [
      ["image: ${IMG}", "image"],
      ['ports: ["${P}:80"]', "ports"],
      ["env_file: ${F}", "env_file"],
      ['volumes: ["${V}:/data"]', "volumes"],
      ["network_mode: ${N}", "network_mode"],
      ["user: ${U}", "user"],
    ];
    for (const [field, key] of throughAllowedKeys) {
      expect(dollar(field), field).toThrow(new ParseError(`c.yaml:4: $ in ${key}`));
    }
    expect(dollar("privileged: ${P}")).toThrow(new ParseError("c.yaml:4: service key privileged"));
    refused(`${base}    environment:\n      \${K}: v\n`);
    refused(`${base}    environment:\n      A: pre\${B}\n`);
    refused(`${base}    environment:\n      A:\n`);
  });
  // P1.30n: a network's `name` is the real Docker network name, so two keys could share one network, or one key could
  // take another's `<project>_<key>`, merging networks the C17 table keeps apart. The project `name:` stays allowed.
  test("network_name_is_refused", () => {
    const stack = (networks: string) => `${base}    networks: [a, b]\nnetworks:\n${networks}`;
    // The project-level `name:` alone, with no network `name`, is accepted.
    expect(parseCompose(stack("  a: {}\n  b: {}\n"), "c.yaml").name).toBe("unset-prod");
    expect(() => parseCompose(stack("  a:\n    name: shared\n  b:\n    name: shared\n"), "c.yaml")).toThrow(
      /network a: name is refused/,
    );
    expect(() => parseCompose(stack("  a:\n    name: unset-prod_b\n  b: {}\n"), "c.yaml")).toThrow(
      /network a: name is refused/,
    );
  });
  // P1.30u: the edge service's mounts decide which Caddy config runs (C18), so `volumes` is read in a strict subset:
  // short `SOURCE:TARGET[:ro|rw]` with a path source starting /, ./ or ../ or a plain volume name, or long syntax with
  // only type (bind, volume, tmpfs), source, target and read_only. Compose-spec 05-services.md "volumes".
  test("volumes_read_in_the_subset", () => {
    const mounts = (lines: string) =>
      parseCompose(`${base}    volumes:\n${lines}volumes:\n  data: {}\n`, "c.yaml").services[0]?.mounts;
    expect(mounts("      - ./sites:/etc/caddy/sites/enabled:ro\n      - data:/data\n      - /cache\n")).toEqual([
      { type: "bind", source: "./sites", target: "/etc/caddy/sites/enabled", readOnly: true },
      { type: "volume", source: "data", target: "/data", readOnly: false },
      { type: "volume", source: null, target: "/cache", readOnly: false },
    ]);
    expect(
      mounts(
        "      - type: tmpfs\n        target: /tmp\n      - type: bind\n        source: /srv\n        target: /srv\n        read_only: true\n",
      ),
    ).toEqual([
      { type: "tmpfs", source: null, target: "/tmp", readOnly: false },
      { type: "bind", source: "/srv", target: "/srv", readOnly: true },
    ]);
    for (const entry of [
      "~/sites:/etc/caddy",
      "C:\\\\sites:/etc/caddy",
      "./a:/b:z",
      "./a:/b:ro:x",
      "./a:relative",
      "{type: image, source: x, target: /etc/caddy}",
      "{type: bind, source: ./a, target: /b, bind: {propagation: shared}}",
      "{type: bind, target: /b}",
      '{type: bind, source: ./a, target: /b, read_only: "true"}',
    ]) {
      expect(() => mounts(`      - ${entry}\n`), entry).toThrow(ParseError);
    }
    refused(`${base}    volumes_from: [other]\n`);
  });
  // P1.30w (architecture ruling B1): a key the preflight never reads could change what runs while every check passes,
  // so each service holds only the keys it reads, and a refusal names the key alone, never its value.
  test("service_keys_outside_the_allowlist_are_refused", () => {
    const caddyfile = "/etc/caddy/Caddyfile";
    for (const [key, yaml] of [
      ["configs", `    configs:\n      - source: edge\n        target: ${caddyfile}\n`],
      ["entrypoint", '    entrypoint: ["caddy", "run", "--config", "/tmp/never-printed"]\n'],
      ["command", "    command: caddy run --config /tmp/never-printed\n"],
    ]) {
      expect(() => parseCompose(`${base}${yaml}`, "c.yaml"), key).toThrow(
        new ParseError(`c.yaml:5: service key ${key}`),
      );
    }
  });
  // P1.30x (architecture record 2026-10-12-p129-compose-service-keys; Codex ruling 2 in 2026-10-12-batch33-codex-rulings):
  // each hardening and limit key is read in one shape, and a value the ruling does not allow is refused by key name.
  test("hardening_keys_read_in_the_subset", () => {
    const hardened = parseCompose(
      `${base}    read_only: true\n    cap_drop: [ALL]\n    cap_add: [NET_BIND_SERVICE]\n` +
        `    security_opt: [no-new-privileges:true]\n    user: "65532:65532"\n    mem_limit: 512m\n` +
        `    cpus: 0.5\n    pids_limit: 128\n    restart: unless-stopped\n`,
      "c.yaml",
    );
    expect(hardened.services[0]?.hardening).toEqual({
      readOnly: true,
      capDrop: ["ALL"],
      capAdd: ["NET_BIND_SERVICE"],
      securityOpt: ["no-new-privileges:true"],
      user: "65532:65532",
      memLimit: "512m",
      cpus: 0.5,
      pidsLimit: 128,
      restart: "unless-stopped",
    });
    expect(
      parseCompose(`${base}    user: "999"\n    cpus: "1.5"\n    mem_limit: 1g\n`, "c.yaml").services[0]?.hardening,
    ).toMatchObject({ user: "999", cpus: 1.5, memLimit: "1g" });
    // Codex 4249566407: `2.0` is a positive number as written, not an ambiguous one (phase-4.md plans `cpus: 2.0`).
    expect(parseCompose(`${base}    cpus: 2.0\n`, "c.yaml").services[0]?.hardening.cpus).toBe(2);
    expect(parseCompose(base, "c.yaml").services[0]?.hardening).toEqual({
      readOnly: null,
      capDrop: [],
      capAdd: [],
      securityOpt: [],
      user: null,
      memLimit: null,
      cpus: null,
      pidsLimit: null,
      restart: null,
    });
  });
  test("hardening_values_outside_the_ruling_are_refused", () => {
    const drop = "    cap_drop: [ALL]\n";
    for (const [yaml, why] of [
      ["    cap_drop: [NET_RAW]\n", "cap_drop is not [ALL]"],
      ["    cap_drop: [ALL, NET_RAW]\n", "cap_drop is not [ALL]"],
      ["    cap_drop: ALL\n", "cap_drop is not a list"],
      [`    cap_add: [SYS_ADMIN]\n${drop}`, "cap_add is not [NET_BIND_SERVICE]"],
      ["    cap_add: [NET_BIND_SERVICE]\n", "cap_add without cap_drop [ALL]"],
      ["    security_opt: [seccomp:unconfined]\n", "security_opt is not [no-new-privileges:true]"],
      [
        '    security_opt: ["no-new-privileges:true", "label:disable"]\n',
        "security_opt is not [no-new-privileges:true]",
      ],
      ["    user: root\n", "user is not a non-zero UID[:GID] string"],
      ['    user: "0:0"\n', "user is not a non-zero UID[:GID] string"],
      ['    user: "1000:0"\n', "user is not a non-zero UID[:GID] string"],
      ["    user: 0\n", "user is not a non-zero UID[:GID] string"],
      ["    user: 65532\n", "user is not a non-zero UID[:GID] string"],
      ["    pids_limit: -1\n", "pids_limit is not an integer from 1 to 4096"],
      ["    pids_limit: 0\n", "pids_limit is not an integer from 1 to 4096"],
      ["    pids_limit: 4097\n", "pids_limit is not an integer from 1 to 4096"],
      ['    pids_limit: "128"\n', "pids_limit is not an integer from 1 to 4096"],
      ['    read_only: "true"\n', "read_only is not true or false"],
      ["    read_only: True\n", "read_only is ambiguous"],
      ["    mem_limit: 536870912\n", "mem_limit is not a size in m or g"],
      ["    mem_limit: 0m\n", "mem_limit is not a size in m or g"],
      ["    cpus: 0\n", "cpus is not a positive number"],
      ["    cpus: -1\n", "cpus is not a positive number"],
      ["    restart: sometimes\n", "restart is not no, on-failure, unless-stopped or always"],
    ]) {
      expect(() => parseCompose(`${base}${yaml}`, "c.yaml"), yaml).toThrow(new ParseError(`c.yaml:5: ${why}`));
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    expect(() => parseCompose(`${base}    user: \${UID}\n`, "c.yaml")).toThrow(new ParseError("c.yaml:5: $ in user"));
  });
  // P1.30y (architecture record 2026-10-12-p129-compose-service-keys; Codex ruling 4 in 2026-10-12-batch33-codex-rulings;
  // step book record 2026-10-12-late-codex-640-644): the B1 risk keys, each in one shape. `build` is kept as written
  // (C26 resolves and judges it), a tmpfs target is /tmp or /var/run/postgresql (C27 keeps the second to postgres),
  // and a service secret is a declared name whose target Compose fixes at /run/secrets/<name>.
  const b1 = (service: string, secrets = "secrets:\n  db_password:\n    file: ./x\n") =>
    `${base}${service}  pds:\n    image: y\n${secrets}`;
  test("build_tmpfs_depends_on_and_secrets_read_in_the_subset", () => {
    const [edge, pds] = parseCompose(
      b1(
        "    build:\n      context: ..\n      dockerfile: deployment/edge/Dockerfile\n" +
          '    tmpfs: [/tmp, "/var/run/postgresql:uid=999,gid=999,mode=0755,size=16m,noexec,nosuid,nodev"]\n' +
          "    depends_on:\n      pds:\n        condition: service_healthy\n    secrets: [db_password]\n",
      ),
      "c.yaml",
    ).services;
    expect(edge).toMatchObject({
      build: { context: "..", dockerfile: "deployment/edge/Dockerfile" },
      tmpfs: [
        { target: "/tmp", options: null },
        { target: "/var/run/postgresql", options: "uid=999,gid=999,mode=0755,size=16m,noexec,nosuid,nodev" },
      ],
      dependsOn: [{ service: "pds", condition: "service_healthy" }],
      secrets: ["db_password"],
    });
    expect(pds).toMatchObject({ build: null, tmpfs: [], dependsOn: [], secrets: [] });
    const short = parseCompose(b1("    depends_on: [pds]\n"), "c.yaml").services[0];
    expect(short?.dependsOn).toEqual([{ service: "pds", condition: "service_started" }]);
    expect(parseCompose(b1(""), "c.yaml").secretFiles).toEqual(["./x"]);
  });
  test("b1_values_outside_the_ruling_are_refused", () => {
    for (const [yaml, why] of [
      ["    build: .\n", "build is not {context, dockerfile}"],
      [
        "    build: {context: .., dockerfile: deployment/images/node-app.Dockerfile, target: deps}\n",
        "build key target",
      ],
      ["    build: {context: ..}\n", "build is not {context, dockerfile}"],
      ["    tmpfs: [/etc/caddy/snippets]\n", "tmpfs target is not /tmp or /var/run/postgresql"],
      ["    tmpfs: [/run/secrets]\n", "tmpfs target is not /tmp or /var/run/postgresql"],
      ["    tmpfs: /tmp\n", "tmpfs is not a list"],
      ['    tmpfs: ["/tmp:exec"]\n', "tmpfs option is refused"],
      ['    tmpfs: ["/tmp:size=1g,suid"]\n', "tmpfs option is refused"],
      ["    volumes: [{type: tmpfs, target: /etc/caddy}]\n", "volume tmpfs target is not /tmp or /var/run/postgresql"],
      ["    depends_on: {ghost: {condition: service_healthy}}\n", "depends_on names a service not in this file"],
      ["    depends_on: [ghost]\n", "depends_on names a service not in this file"],
      ["    depends_on: {pds: {condition: service_healthy, required: false}}\n", "depends_on key required"],
      ["    depends_on: {pds: {condition: service_healthy, restart: true}}\n", "depends_on key restart"],
      [
        "    depends_on: {pds: {condition: sometimes}}\n",
        "depends_on condition is not service_started, service_healthy or service_completed_successfully",
      ],
      ["    depends_on: pds\n", "depends_on is not a list or mapping"],
      ["    secrets: [{source: db_password, target: /etc/caddy/Caddyfile}]\n", "secrets long form is refused"],
      ["    secrets: [../x]\n", "secret name is refused"],
      ["    secrets: [other]\n", "secret is not declared"],
      ["    secrets: db_password\n", "secrets is not a list"],
    ] as [string, string][]) {
      expect(() => parseCompose(b1(yaml), "c.yaml"), yaml).toThrow(new ParseError(`c.yaml:5: ${why}`));
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    for (const [yaml, key] of [
      ['    build: {context: .., dockerfile: "${D}"}\n', "build"],
      ['    tmpfs: ["${T}"]\n', "tmpfs"],
      ['    depends_on: ["${S}"]\n', "depends_on"],
      ['    secrets: ["${S}"]\n', "secrets"],
    ] as [string, string][]) {
      expect(() => parseCompose(b1(yaml), "c.yaml"), yaml).toThrow(new ParseError(`c.yaml:5: $ in ${key}`));
    }
  });
  test("top_level_secret_is_exactly_a_file", () => {
    const top = (secret: string) => () => parseCompose(`${base}secrets:\n  db_password: ${secret}\n`, "c.yaml");
    for (const secret of ["{}", "{file: 3}", "never-printed", "{file: [x]}"]) {
      expect(top(secret), secret).toThrow(new ParseError("c.yaml:6: secret db_password is not exactly {file}"));
    }
    for (const [secret, key] of [
      ["{file: x, external: true}", "external"],
      ["{environment: X}", "environment"],
      ["{content: y}", "content"],
      ["{file: x, name: other}", "name"],
    ] as [string, string][]) {
      expect(top(secret), secret).toThrow(new ParseError(`c.yaml:6: secret db_password: ${key} is refused`));
    }
  });
  test("preflight_refuses_ambiguous_scalars", () => refused(`${base}    environment:\n      A: 0123\n`));
  // P1.30k (step book record 2026-10-12-p130k-compose-top-level-allowlist): the top level holds only the keys the
  // parser reads, a named volume is declared by name alone, and a long-form port holds only what port() reads.
  test("top_level_keys_outside_the_allowlist_are_refused", () => {
    for (const [key, yaml] of [
      ["configs", "configs:\n  edge:\n    file: ./never-printed\n"],
      ["x-shared", "x-shared:\n  a: 1\n"],
    ]) {
      expect(() => parseCompose(`${base}${yaml}`, "c.yaml"), key).toThrow(
        new ParseError(`c.yaml:5: top-level key ${key}`),
      );
    }
  });
  test("include_keeps_its_own_refusal", () => {
    expect(() => parseCompose(`${base}include: [never-printed.yaml]\n`, "c.yaml")).toThrow(
      new ParseError("c.yaml:5: include"),
    );
  });
  test("named_volume_settings_are_refused", () => {
    const bind =
      "volumes:\n  data:\n    driver: local\n    driver_opts:\n      type: none\n      o: bind\n      device: /etc\n";
    expect(() => parseCompose(`${base}${bind}`, "c.yaml")).toThrow(new ParseError("c.yaml:7: volume data: driver"));
    // Each refused key fails on its own: a device mapping with no driver, and an external volume (P1.30j).
    const device = "volumes:\n  data:\n    driver_opts:\n      type: none\n      o: bind\n      device: /etc\n";
    expect(() => parseCompose(`${base}${device}`, "c.yaml")).toThrow(
      new ParseError("c.yaml:7: volume data: driver_opts"),
    );
    expect(() => parseCompose(`${base}volumes:\n  data:\n    external: true\n`, "c.yaml")).toThrow(
      new ParseError("c.yaml:7: volume data: external"),
    );
    for (const key of ["driver_opts", "external", "name", "labels"]) {
      expect(() => parseCompose(`${base}volumes:\n  data:\n    ${key}: x\n`, "c.yaml"), key).toThrow(
        new ParseError(`c.yaml:7: volume data: ${key}`),
      );
    }
    expect(() => parseCompose(`${base}volumes:\n  data: never-printed\n`, "c.yaml")).toThrow(
      new ParseError("c.yaml:6: volume data is not a mapping"),
    );
    expect(() => parseCompose(`${base}volumes:\n  data:\n  logs: {}\n`, "c.yaml")).not.toThrow();
    expect(() => parseCompose(`${base}volumes:\n  ../x: {}\n`, "c.yaml")).toThrow(
      new ParseError("c.yaml:6: volume name ../x is refused"),
    );
  });
  test("undeclared_named_volume_is_refused", () => {
    for (const mount of ["data:/data", "{type: volume, source: data, target: /data}"]) {
      expect(() => parseCompose(`${base}    volumes: [${mount}]\n`, "c.yaml"), mount).toThrow(
        new ParseError("c.yaml:5: volume data is not declared"),
      );
      expect(() => parseCompose(`${base}    volumes: [${mount}]\nvolumes:\n  data: {}\n`, "c.yaml")).not.toThrow();
    }
    // An anonymous volume and a bind need no declaration.
    expect(() => parseCompose(`${base}    volumes: [/cache, ./x:/x]\n`, "c.yaml")).not.toThrow();
  });
  test("long_form_port_keys_outside_the_set_are_refused", () => {
    for (const key of ["protocol", "mode", "name", "app_protocol"]) {
      expect(() => parseCompose(`${base}    ports:\n      - target: 80\n        ${key}: x\n`, "c.yaml"), key).toThrow(
        new ParseError(`c.yaml:7: port key ${key}`),
      );
    }
  });
});

describe("env file subset", () => {
  test("preflight_reads_strict_env_files", () => {
    expect(parseEnvFile("# note\n\nA=1\nB=\nC='lit $x'\n", "e.env")).toEqual([
      ["A", "1"],
      ["B", ""],
      ["C", "lit $x"],
    ]);
    // Anything Compose would interpolate, unquote or split differently is refused.
    for (const line of ['A="q"', "A=$B", "A=a b", "A=a#b", "export A=1", "1A=x"]) {
      expect(() => parseEnvFile(`${line}\n`, "e.env"), line).toThrow();
    }
  });
});

const digest = `sha256:${"a".repeat(64)}`;
// Every field the parser reads, so the comparison covers its whole view: a whole-reference and a `$$` value, env
// files and file secrets (the files exist, as Compose requires), and networks in both service forms beside a service
// on the implicit default network (P1.30t), every hardening and limit key in each scalar form it accepts (P1.30x), and
// build, tmpfs, both depends_on forms and a short-form service secret (P1.30y).
const STACK = `name: unset-prod
services:
  edge:
    image: ghcr.io/undefined6799/edge@${digest}
    read_only: true
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt: [no-new-privileges:true]
    user: "65532:65532"
    mem_limit: 256m
    cpus: 2.0
    pids_limit: 128
    restart: unless-stopped
    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]
    networks:
      front:
        aliases: [edge]
      inner:
    volumes:
      - ./sites:/etc/caddy/sites/enabled:ro
      - data:/data
      - type: tmpfs
        target: /tmp
  pds:
    image: ghcr.io/undefined6799/mirror/pds@${digest}
    env_file: [pds.env]
    environment:
      PDS_HOSTNAME: pds.example.test
      PDS_PRICE: one$$
      PDS_ADMIN_PASSWORD: \${PDS_ADMIN_PASSWORD}
    ports:
      - target: 3000
        published: "3000"
        host_ip: 127.0.0.1
    networks: [inner]
    depends_on: [edge]
    secrets: [pds_admin]
  web:
    image: ghcr.io/undefined6799/web@${digest}
    build:
      context: .
      dockerfile: deployment/edge/Dockerfile
    tmpfs: ["/tmp:size=16m,noexec,nosuid,nodev"]
    depends_on:
      edge:
        condition: service_healthy
    read_only: false
    user: "65532"
    mem_limit: 1g
    cpus: "1.5"
    restart: "no"
networks:
  front: {}
  inner:
    internal: true
    driver: bridge
volumes:
  data: {}
secrets:
  pds_admin:
    file: ./pds-admin.secret
`;

/** Whether `docker compose` runs here; CI must have it (the architecture record's anti-drift test runs there). */
const hasCompose = (() => {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ROOT = join(import.meta.dirname, "..", "..");
/** Every compose file in the repository (P1.29 adds compose.dev.yaml, P5.03 the production one). */
const repositoryFiles = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--", ":(glob)**/compose*.yaml"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((file) => join(ROOT, file));

type Theirs = {
  name: string;
  services: Record<
    string,
    {
      image: string;
      env_file?: { path: string }[];
      environment?: Record<string, string | null>;
      ports?: { target: number; published?: string; host_ip?: string }[];
      networks?: Record<string, unknown>;
      network_mode?: string;
      volumes?: { type: string; source?: string; target: string; read_only?: boolean }[];
      read_only?: boolean;
      cap_drop?: string[];
      cap_add?: string[];
      security_opt?: string[];
      user?: string;
      mem_limit?: string;
      cpus?: number | string;
      pids_limit?: number;
      restart?: string;
      build?: { context: string; dockerfile: string };
      tmpfs?: string[];
      depends_on?: Record<string, { condition: string; required: boolean }>;
      secrets?: { source: string; target: string }[];
    }
  >;
  networks?: Record<string, { internal?: boolean }>;
  secrets?: Record<string, { file?: string }>;
};

/** Compose's reading of `file` (never the preflight's: only this test runs Compose), with nothing interpolated. */
function composeConfig(file: string): Theirs {
  const json = execFileSync("docker", ["compose", "-f", file, "config", "--format", "json", "--no-interpolate"], {
    encoding: "utf8",
  });
  return JSON.parse(json) as Theirs;
}

/** The parser's whole view of `file`, in Compose's terms: paths resolved beside the file, values as written. */
function oursAsCompose(file: string) {
  const ours = parseCompose(readFileSync(file, "utf8"), file);
  return {
    name: ours.name,
    services: Object.fromEntries(
      ours.services.map((service) => [
        service.name,
        {
          image: service.image,
          envFiles: service.envFiles.map((path) => resolve(dirname(file), path)),
          environment: Object.fromEntries(
            service.environment.map(([key, value]) => [
              key,
              "ref" in value ? `\${${value.ref}}` : value.literal.replaceAll("$", () => "$$"),
            ]),
          ),
          ports: service.ports,
          networks: [...service.networks].sort(),
          networkMode: service.networkMode,
          hardening: service.hardening,
          // One file here, so its directory is the project directory Compose resolves a context from.
          build:
            service.build === null
              ? null
              : { ...service.build, context: resolve(dirname(file), service.build.context) },
          tmpfs: service.tmpfs.map((entry) =>
            entry.options === null ? entry.target : `${entry.target}:${entry.options}`,
          ),
          dependsOn: Object.fromEntries(
            service.dependsOn.map((d) => [d.service, { condition: d.condition, required: true }]),
          ),
          secrets: service.secrets.map((name) => ({ source: name, target: `/run/secrets/${name}` })),
          mounts: service.mounts.map((m) => ({
            ...m,
            source: m.type === "bind" && m.source !== null ? resolve(dirname(file), m.source) : m.source,
          })),
        },
      ]),
    ),
    networks: Object.fromEntries(networksOf(ours).map((n) => [n.name, { internal: n.internal }])),
    secretFiles: ours.secretFiles.map((path) => resolve(dirname(file), path)).sort(),
  };
}

function theirsAsOurs(theirs: Theirs) {
  return {
    name: theirs.name,
    services: Object.fromEntries(
      Object.entries(theirs.services).map(([name, service]) => [
        name,
        {
          image: service.image,
          envFiles: (service.env_file ?? []).map((entry) => entry.path),
          environment: service.environment ?? {},
          ports: (service.ports ?? []).map((p) => ({
            hostIp: p.host_ip ?? null,
            published: p.published ?? null,
            target: `${p.target}`,
          })),
          networks: Object.keys(service.networks ?? {}).sort(),
          networkMode: service.network_mode ?? null,
          hardening: {
            readOnly: service.read_only ?? null,
            capDrop: service.cap_drop ?? [],
            capAdd: service.cap_add ?? [],
            securityOpt: service.security_opt ?? [],
            user: service.user ?? null,
            memLimit: service.mem_limit ?? null,
            cpus: service.cpus === undefined ? null : Number(service.cpus),
            pidsLimit: service.pids_limit ?? null,
            restart: service.restart ?? null,
          },
          build: service.build ?? null,
          tmpfs: service.tmpfs ?? [],
          dependsOn: service.depends_on ?? {},
          secrets: service.secrets ?? [],
          mounts: (service.volumes ?? []).map((v) => ({
            type: v.type,
            source: v.source ?? null,
            target: v.target,
            readOnly: v.read_only ?? false,
          })),
        },
      ]),
    ),
    networks: Object.fromEntries(
      Object.entries(theirs.networks ?? {}).map(([name, n]) => [name, { internal: n.internal ?? false }]),
    ),
    secretFiles: Object.values(theirs.secrets ?? {})
      .flatMap((secret) => (secret.file === undefined ? [] : [secret.file]))
      .sort(),
  };
}

// P1.30z (architecture record 2026-10-12-preflight-project-directory): with several files, every relative path resolves
// from the first file's directory, never from the file that names it. The second file sits in another directory.
const FIRST = "name: unset-prod\nservices:\n  edge:\n    image: x\n";
const SECOND =
  "services:\n  pds:\n    image: y\n    env_file: [e.env]\n    volumes: [./data:/data]\nsecrets:\n  s:\n    file: ./s\n";

/** The paths loadCompose resolved, in the order the agreement test compares them. */
function resolvedPaths(files: string[], readText: (path: string) => string | null) {
  const { compose } = loadCompose(files, readText);
  const pds = compose.services.find((service) => service.name === "pds");
  return {
    binds: (pds?.mounts ?? []).flatMap((m) => (m.type === "bind" && m.source !== null ? [m.source] : [])),
    envFiles: pds?.envFiles ?? [],
    secretFiles: compose.secretFiles,
  };
}

describe("compose project directory", () => {
  test("paths_resolve_from_the_first_file_directory", () => {
    const texts = new Map([
      ["/p/a/c.yaml", FIRST],
      ["/p/b/c.yaml", SECOND],
    ]);
    expect(resolvedPaths(["/p/a/c.yaml", "/p/b/c.yaml"], (path) => texts.get(path) ?? null)).toEqual({
      binds: ["/p/a/data"],
      envFiles: ["/p/a/e.env"],
      secretFiles: ["/p/a/s"],
    });
  });
});

describe("compose agreement", () => {
  const dir = mkdtempSync(join(tmpdir(), "compose-parse-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // P1.30 core (step book record 2026-10-07-p130p-as-built): the parser's whole view (name, services, image, ports,
  // env_file, environment, file secrets and, from P1.30t, networks: each service's, its network_mode, and every network
  // with its internal flag) against Compose's, for the fixture and every compose*.yaml in the repository.
  test.runIf(hasCompose || process.env.CI)("preflight_matches_compose_config", async ({ annotate }) => {
    const fixture = join(dir, "compose.yaml");
    writeFileSync(fixture, STACK);
    writeFileSync(join(dir, "pds.env"), "PDS_PORT=3000\n");
    writeFileSync(join(dir, "pds-admin.secret"), "");
    const real = repositoryFiles();
    if (real.length === 0)
      await annotate(
        "preflight_matches_compose_config: no compose*.yaml in the repository yet, so the fixture alone was compared",
      );
    for (const file of [fixture, ...real]) {
      expect(oursAsCompose(file), file).toEqual(theirsAsOurs(composeConfig(file)));
    }
  });

  test.runIf(hasCompose || process.env.CI)("project_directory_matches_compose_config", () => {
    const [first, second] = [join(dir, "a", "c.yaml"), join(dir, "b", "c.yaml")];
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    writeFileSync(first, FIRST);
    writeFileSync(second, SECOND);
    writeFileSync(join(dir, "a", "e.env"), "");
    const json = execFileSync(
      "docker",
      ["compose", "-f", first, "-f", second, "config", "--format", "json", "--no-interpolate"],
      { encoding: "utf8" },
    );
    const theirs = theirsAsOurs(JSON.parse(json) as Theirs);
    const pds = theirs.services.pds;
    expect(resolvedPaths([first, second], (path) => readFileSync(path, "utf8"))).toEqual({
      binds: (pds?.mounts ?? []).flatMap((m) => (m.type === "bind" && m.source !== null ? [m.source] : [])),
      envFiles: pds?.envFiles,
      secretFiles: theirs.secretFiles,
    });
  });
});
