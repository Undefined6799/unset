// P1.30: the strict Compose subset the preflight reads (architecture record 2026-10-07-p130-preflight-location-and-yaml):
// anything Compose could read differently from us is refused rather than guessed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { networksOf, ParseError, parseCompose, parseEnvFile, refuseAliasesByOption } from "./compose-parse.ts";

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
    // answers; `user` and `privileged` above now stop at the key allowlist first.
    const dollar = (field: string) => () =>
      parseCompose(`name: unset-prod\nservices:\n  edge:\n    ${field}\n`, "c.yaml");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    const throughAllowedKeys: [string, string][] = [
      ["image: ${IMG}", "image"],
      ['ports: ["${P}:80"]', "ports"],
      ["env_file: ${F}", "env_file"],
      ['volumes: ["${V}:/data"]', "volumes"],
      ["network_mode: ${N}", "network_mode"],
    ];
    for (const [field, key] of throughAllowedKeys) {
      expect(dollar(field), field).toThrow(new ParseError(`c.yaml:4: $ in ${key}`));
    }
    expect(dollar("user: ${U}")).toThrow(new ParseError("c.yaml:4: service key user"));
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
      [
        "secrets",
        `    secrets:\n      - source: edge\n        target: ${caddyfile}\nsecrets:\n  edge:\n    file: ./x\n`,
      ],
      ["tmpfs", "    tmpfs: [/etc/caddy/snippets]\n"],
      ["entrypoint", '    entrypoint: ["caddy", "run", "--config", "/tmp/never-printed"]\n'],
      ["command", "    command: caddy run --config /tmp/never-printed\n"],
    ]) {
      expect(() => parseCompose(`${base}${yaml}`, "c.yaml"), key).toThrow(
        new ParseError(`c.yaml:5: service key ${key}`),
      );
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
// on the implicit default network (P1.30t).
const STACK = `name: unset-prod
services:
  edge:
    image: ghcr.io/undefined6799/edge@${digest}
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
  web:
    image: ghcr.io/undefined6799/web@${digest}
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
});
