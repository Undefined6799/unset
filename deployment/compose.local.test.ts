// P1.34d item 11: compose.local.yaml is compose.dev.yaml plus exactly the differences a throwaway stack on one machine
// needs (book edit 2026-10-13-p127l-to-third-lane, Amendment 4; architecture record 2026-10-13-p127l-local-gaps,
// Amendments 1 and 2). The preflight runs in full on the local file too; this catches a weakening it would allow, in
// either direction, naming the service and the key. Every service key is compared, `environment` and `env_file` too
// (item 11 holds over item 14: step book 03:46Z, book edit 2026-10-14-p134d-split, "verify-903-8b2abfc S1"). A
// local-only service has no dev twin, so its environment and env_file are pinned here instead (P1.35r I-2).
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  type Stats,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pdsNeighbours } from "./preflight/checks/networks.ts";
import {
  type Compose,
  type EnvValue,
  type Hardening,
  type Mount,
  parseCompose,
  type Service,
  TOKEN_READER,
} from "./preflight/compose-parse.ts";
import { type Deps, preflight } from "./preflight/index.ts";
import { loadInputs } from "./preflight/inputs.ts";
import { isLocalOnlyNetwork, LOCAL_ONLY_NETWORKS, LOCAL_ONLY_SERVICES } from "./preflight/local-only.ts";

const DEPLOYMENT = import.meta.dirname;
const parse = (file: string): Compose => parseCompose(readFileSync(join(DEPLOYMENT, file), "utf8"), file);

/** The dev root's public folder, bound read-only into pds and web only (item 5). */
const TRUST: Mount = { type: "bind", source: "../../unset-dev-trust", target: "/etc/unset-dev-trust", readOnly: true };
/** What the local file may add to a service, beyond dev's: mounts, secrets and networks, by service. */
const ADDED: Record<string, { mounts?: Mount[]; secrets?: string[]; networks?: string[] }> = {
  pds: { mounts: [TRUST] },
  web: { mounts: [TRUST] },
  edge: { secrets: ["local_tls_cert", "local_tls_key"] },
};
/**
 * The environment values the local file may set where dev differs, by service and key (item 11): the trusted root on
 * pds and web, and `UNSET_ENV` once P1.34z writes `local`. The PLC URL is not among them: both PDSes publish to
 * plc.directory (ADR 0023). The edge's app-site keys are APP_SITE's.
 */
const ENV_ALLOWED: Record<string, Record<string, EnvValue>> = {
  pds: { NODE_EXTRA_CA_CERTS: { literal: "/etc/unset-dev-trust/root.pem" } },
  web: { NODE_EXTRA_CA_CERTS: { literal: "/etc/unset-dev-trust/root.pem" } },
};
const UNSET_ENV_LOCAL: EnvValue = { literal: "local" };
/**
 * Item 12's app site on the local edge, and the two keys its app.caddy reads with no default. They come together: with
 * the mount the edge needs both keys exactly, without it neither, and no other service or file may set them (step book
 * 04:03Z, book edit 2026-10-14-p134d-split, last section).
 */
const APP_SITE: { mount: Mount; environment: [string, EnvValue][] } = {
  mount: {
    type: "bind",
    source: "./edge/local/app.caddy",
    target: "/etc/caddy/sites/enabled/app.caddy",
    readOnly: true,
  },
  environment: [
    ["APP_HOST", { ref: "APP_HOST" }],
    ["APP_UPSTREAM", { literal: "web:8080" }],
  ],
};
const APP_SITE_KEYS = new Set(APP_SITE.environment.map(([key]) => key));
/** The edge's sites, each its own read-only file in local (item 12), where dev binds the sites folder. */
const EDGE_SITES: { dev: Mount[]; local: Mount[] } = {
  dev: [{ type: "bind", source: "./edge/sites", target: "/etc/caddy/sites/enabled", readOnly: true }],
  local: [
    { type: "bind", source: "./edge/sites/pds.caddy", target: "/etc/caddy/sites/enabled/pds.caddy", readOnly: true },
    APP_SITE.mount,
    { type: "bind", source: "./edge/local/tls.caddy", target: "/etc/caddy/snippets/tls.caddy", readOnly: true },
  ],
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const without = <T>(list: readonly T[], drop: readonly T[] = []): T[] =>
  list.filter((x) => !drop.some((d) => same(d, x)));

/** Each environment key of one service whose value differs beyond ENV_ALLOWED, or that a list repeats. */
function environmentDrift(dev: Service, local: Service): string[] {
  const allowed = ENV_ALLOWED[dev.name] ?? {};
  const devEnv = new Map(dev.environment);
  const localEnv = new Map(local.environment);
  const problems = [dev, local]
    .filter((s) => new Map(s.environment).size !== s.environment.length)
    .map(() => `${dev.name}: environment repeats a key`);
  for (const key of new Set([...devEnv.keys(), ...localEnv.keys()])) {
    if (devEnv.has(key) && APP_SITE_KEYS.has(key)) problems.push(`${dev.name}: environment ${key} is in the dev file`);
    if (dev.name === "edge" && APP_SITE_KEYS.has(key)) continue;
    const value = localEnv.get(key);
    const permitted =
      same(devEnv.get(key), value) ||
      (allowed[key] !== undefined && same(allowed[key], value)) ||
      (key === "UNSET_ENV" && devEnv.has(key) && same(UNSET_ENV_LOCAL, value));
    if (!permitted) problems.push(`${dev.name}: environment ${key} differs`);
  }
  return dev.name === "edge" ? [...problems, ...appSiteDrift(local)] : problems;
}

/** Whether the local edge has the app-site mount and its two keys together, or neither (APP_SITE). */
function appSiteDrift(edge: Service): string[] {
  const site = edge.mounts.some((m) => same(m, APP_SITE.mount));
  const keys = edge.environment.filter(([key]) => APP_SITE_KEYS.has(key));
  const expected = site ? APP_SITE.environment : [];
  const byKey = (list: [string, EnvValue][]) => [...list].sort(([a], [b]) => a.localeCompare(b));
  return same(byKey(keys), byKey(expected))
    ? []
    : ["edge: the app site and APP_HOST and APP_UPSTREAM do not come together"];
}

/** The env directory beside the checkout (docs/human/runbooks/dev-stack-secrets.md), the only folder item 11 allows. */
const ENV_DIR = "../../unset-dev-env";
/** Whether the env files correspond one to one, in order, by name, each in the env directory in both files (item 11). */
const envFilesAgree = (dev: Service, local: Service): boolean =>
  same(
    dev.envFiles.map((path) => basename(path)),
    local.envFiles.map((path) => basename(path)),
  ) && [...dev.envFiles, ...local.envFiles].every((path) => dirname(path) === ENV_DIR);

/** Each key of one service that differs between the files beyond what item 11 allows; every key is compared. */
function serviceDrift(dev: Service, local: Service): string[] {
  const added = ADDED[dev.name] ?? {};
  const devMounts = dev.name === "edge" ? without(dev.mounts, EDGE_SITES.dev) : dev.mounts;
  const localMounts = without(local.mounts, [
    ...(added.mounts ?? []),
    ...(dev.name === "edge" ? EDGE_SITES.local : []),
  ]);
  const built = local.build !== null && dev.build === null;
  // Keys compared other than as written; any key not named here is compared exactly, so a key compose-parse comes to
  // read is compared from the day it is added.
  const special: { [K in keyof Service]?: () => string[] } = {
    name: () => [],
    hardening: () =>
      Object.keys({ ...dev.hardening, ...local.hardening })
        .filter((key) => !same(dev.hardening[key as keyof Hardening], local.hardening[key as keyof Hardening]))
        .map((key) => `${dev.name}: ${key} differs`),
    // A pulled image may be built locally instead (judged by C2 to C5, C18, C25 and C27 under the card), never the
    // other way round.
    image: () => (same(dev.image, built ? dev.image : local.image) ? [] : [`${dev.name}: image differs`]),
    build: () => (same(dev.build, built ? null : local.build) ? [] : [`${dev.name}: build differs`]),
    networks: () =>
      same(dev.networks, without(local.networks, [...(added.networks ?? []), ...localOnlyOf(dev.name)]))
        ? []
        : [`${dev.name}: networks differs`],
    mounts: () => (same(devMounts, localMounts) ? [] : [`${dev.name}: mounts differs`]),
    secrets: () => (same(dev.secrets, without(local.secrets, added.secrets)) ? [] : [`${dev.name}: secrets differs`]),
    environment: () => environmentDrift(dev, local),
    envFiles: () => (envFilesAgree(dev, local) ? [] : [`${dev.name}: env_file differs`]),
  };
  const keys = new Set([...Object.keys(dev), ...Object.keys(local)] as (keyof Service)[]);
  const compared = [...keys].flatMap((key) => {
    const judge = special[key];
    if (judge !== undefined) return judge();
    return same(dev[key], local[key]) ? [] : [`${dev.name}: ${key} differs`];
  });
  // Added items must be there in full, so a missing trust mount or leaf secret is a difference too.
  const missingAdded =
    !(added.mounts ?? []).every((m) => local.mounts.some((x) => same(x, m))) ||
    !(added.networks ?? []).every((n) => local.networks.includes(n)) ||
    !(added.secrets ?? []).every((n) => local.secrets.includes(n));
  return [...compared, ...(missingAdded ? [`${dev.name}: an allowed local addition is missing`] : [])];
}

/** The local-only networks `service` is a listed member of. */
const localOnlyOf = (service: string): string[] =>
  [...LOCAL_ONLY_NETWORKS].filter(([, row]) => row.members.includes(service)).map(([name]) => name);

/** Each local-only network the local file holds other than as listed, with exactly its listed members. */
function localOnlyNetworkDrift(local: Compose): string[] {
  const problems: string[] = [];
  for (const network of local.networks.filter(({ name }) => isLocalOnlyNetwork(name))) {
    const row = LOCAL_ONLY_NETWORKS.get(network.name);
    if (row === undefined) problems.push(`${network.name} is not on the local-only list`);
  }
  for (const [name, row] of LOCAL_ONLY_NETWORKS) {
    const network = local.networks.find((n) => n.name === name);
    const members = local.services.filter((s) => s.networks.includes(name)).map((s) => s.name);
    if (
      network === undefined ||
      network.internal !== row.internal ||
      !same([...members].sort(), [...row.members].sort())
    )
      problems.push(`${name} differs from the local-only list`);
  }
  return problems;
}

/**
 * The environment and env_file of each local-only service, exactly as compose.local.yaml writes them (P1.35r I-2): a
 * literal, or a `${VAR}` reference kept as text and never resolved, so no secret enters this table. The reader has
 * neither (compose.local.yaml: "No network, no env, no secret"); P1.34v adds plc's pin and P1.29s seed's.
 */
const LOCAL_ONLY_PINS: ReadonlyMap<string, { environment: Record<string, string>; envFiles: string[] }> = new Map([
  [TOKEN_READER, { environment: {}, envFiles: [] }],
]);

/** A value as the compose file writes it: a reference as `${NAME}`, a literal with each `$` doubled again. */
const asWritten = (value: EnvValue): string =>
  "ref" in value ? `\${${value.ref}}` : value.literal.replaceAll("$", () => "$$");

/** Each local-only service whose environment or env_file is not exactly its pin, or carries a secret as refused. */
function localOnlyDrift(local: Compose): string[] {
  const services = local.services.filter((s) => LOCAL_ONLY_SERVICES.has(s.name));
  const problems = [...LOCAL_ONLY_PINS.keys()]
    .filter((name) => !services.some((s) => s.name === name))
    .map((name) => `${name} is pinned but not in the local file`);
  for (const s of services) {
    const pin = LOCAL_ONLY_PINS.get(s.name);
    if (pin === undefined) problems.push(`${s.name} has no environment and env_file pin`);
    else problems.push(...pinDrift(s, pin.environment, pin.envFiles));
  }
  return problems;
}

/** Each way one service is off its pin: a key added, removed, changed or repeated, a refused secret, its env_file. */
function pinDrift(s: Service, environment: Record<string, string>, envFiles: string[]): string[] {
  const written = s.environment.map(([key, value]): [string, string] => [key, asWritten(value)]);
  const actual = new Map(written);
  const pinned = new Map(Object.entries(environment));
  const problems = actual.size === written.length ? [] : [`${s.name}: environment repeats a key`];
  for (const key of new Set([...actual.keys(), ...pinned.keys()])) {
    if (actual.get(key) !== pinned.get(key)) problems.push(`${s.name}: environment ${key} is not as pinned`);
  }
  // The same predicate holds in compose and in the pin (architecture 12:40Z).
  for (const [where, entries] of [
    ["environment", written],
    ["pin", [...pinned]],
  ] as const) {
    for (const [key, value] of entries) {
      const why = secretRefusal(key, value);
      if (why !== null) problems.push(`${s.name}: ${where} ${why}`);
    }
  }
  return same(s.envFiles, envFiles) ? problems : [...problems, `${s.name}: env_file is not as pinned`];
}

/** The closed list of words that make a key secret-bearing, each matched as a whole `_`-separated word, in any case. */
const SECRET_WORDS = new Set([
  "PASSWORD",
  "PASSWD",
  "PASS",
  "PW",
  "SECRET",
  "TOKEN",
  "KEY",
  "PRIVATE",
  "CREDS",
  "CREDENTIALS",
  "SEED",
  "DSN",
]);
/** Exactly `${NAME:?message}`: NAME in capitals, and a message with a visible character and no `$`, `{` or `}`. */
const REQUIRED_REFERENCE = /^\$\{[A-Z][A-Z0-9_]*:\?[^${}]*[^${}\s][^${}]*\}$/;
/** A braced interpolation, up to its first closing brace. */
const BRACED = /\$\{[^}]*\}/g;
/** What each braced interpolation becomes while a value's URLs are read; a value that holds it is refused. */
const HOLE = "\u0000";
/** A URL's userinfo: after `://`, anything but `/`, `?` and `#` up to an `@`. */
const USERINFO = /:\/\/([^/?#]*)@/g;
const SECRETS_DIR = "/run/secrets/";

/**
 * Why a key and its value as written carry a secret other than as allowed, or null (architecture 12:40Z, the record's
 * section "Architecture on verify-910-a686fe0 S3"). A key is secret-bearing when one of its words is listed, and a
 * value when it holds a URL with userinfo, under any key. Either is accepted only as (1) a `*_FILE` key whose literal
 * value is a path under /run/secrets/, (2) exactly `${NAME:?message}`, or (3) a userinfo URL whose password is exactly
 * one such reference. Everything else is refused. A null value is a bare key, which Compose fills from the shell.
 * Compose's forms (compose-spec 12-interpolation.md, main, read 2026-10-16): `${VAR:?err}` exits with an error if VAR
 * is unset or empty, while `${VAR?err}` passes an empty value; a message may nest an interpolation, so it holds no `$`.
 */
function secretRefusal(key: string, value: string | null): string | null {
  const masked = value?.replaceAll(BRACED, HOLE) ?? "";
  const userinfo = [value ?? "", masked].some((text) => [...text.matchAll(USERINFO)].length > 0);
  if (!userinfo && !key.split("_").some((word) => SECRET_WORDS.has(word.toUpperCase()))) return null;
  const accepted =
    value !== null &&
    !value.includes(HOLE) &&
    (secretFile(key, value) || REQUIRED_REFERENCE.test(value) || referencedPassword(value, masked));
  return accepted ? null : `${key} carries a secret other than as a /run/secrets file or a required reference`;
}

/** A `*_FILE` key whose literal value names a file under /run/secrets/, with no `.`, `..` or empty segment. */
const secretFile = (key: string, value: string): boolean =>
  key.endsWith("_FILE") &&
  value.startsWith(SECRETS_DIR) &&
  !value.endsWith("/") &&
  !value.includes("$") &&
  posix.normalize(value) === value;

/** Whether the value's one userinfo URL has exactly `${NAME:?message}` as its password, and nothing else interpolates. */
function referencedPassword(value: string, masked: string): boolean {
  const urls = [...masked.matchAll(USERINFO)];
  const references = value.match(BRACED) ?? [];
  if (urls.length !== 1 || references.length !== 1 || masked.replaceAll("$$", "").includes("$")) return false;
  const userinfo = urls[0]?.[1] ?? "";
  const colon = userinfo.indexOf(":");
  return colon !== -1 && userinfo.slice(colon + 1) === HOLE && REQUIRED_REFERENCE.test(references[0] ?? "");
}

/** Every difference between the files that the local stack is not allowed; none means they agree. */
function drift(dev: Compose, local: Compose): string[] {
  const problems: string[] = [];
  for (const s of local.services) {
    const twin = dev.services.find((d) => d.name === s.name);
    if (twin === undefined && !LOCAL_ONLY_SERVICES.has(s.name)) problems.push(`${s.name} is only in the local file`);
    if (twin !== undefined) problems.push(...serviceDrift(twin, s));
  }
  for (const s of dev.services) {
    if (LOCAL_ONLY_SERVICES.has(s.name)) problems.push(`${s.name} is in the dev file`);
    else if (!local.services.some((l) => l.name === s.name)) problems.push(`${s.name} is only in the dev file`);
  }
  const shared = local.networks.filter(({ name }) => !LOCAL_ONLY_NETWORKS.has(name));
  if (!same(dev.networks, shared)) problems.push("the networks or their internal flags differ");
  problems.push(...localOnlyNetworkDrift(local), ...localOnlyDrift(local));
  return problems;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (bytes: number[]): string => {
  let value = bytes.reduce((n, b) => n * 256n + BigInt(b), 0n);
  let text = "";
  for (; value > 0n; value /= 58n) text = BASE58[Number(value % 58n)] + text;
  return text;
};

/** A copy of `compose` with `name`'s service changed by `edit`. */
const editService = (compose: Compose, name: string, edit: (s: Service) => Service): Compose => ({
  ...compose,
  services: compose.services.map((s) => (s.name === name ? edit(s) : s)),
});

describe("compose.local.yaml against compose.dev.yaml (P1.34d item 11)", () => {
  const dev = parse("compose.dev.yaml");
  const local = parse("compose.local.yaml");

  test("compose_local_name_pinned", () => {
    expect(local.name).toBe("unset-local");
  });

  test("compose_local_differs_from_dev_only_as_allowed", () => {
    expect(drift(dev, local)).toEqual([]);
  });

  test("a_weakening_in_either_file_is_named", () => {
    const harden = (s: Service, change: Partial<Service["hardening"]>): Service => ({
      ...s,
      hardening: { ...s.hardening, ...change },
    });
    const cases: [Compose, Compose, string][] = [
      [dev, editService(local, "web", (s) => harden(s, { capDrop: [] })), "web: capDrop differs"],
      [dev, editService(local, "pds", (s) => harden(s, { readOnly: false })), "pds: readOnly differs"],
      [dev, editService(local, "postgres", (s) => harden(s, { user: "0:0" })), "postgres: user differs"],
      [editService(dev, "edge", (s) => harden(s, { capAdd: [] })), local, "edge: capAdd differs"],
      [
        dev,
        editService(local, "edge", (s) => ({ ...s, ports: [{ hostIp: null, published: "443", target: "443" }] })),
        "edge: ports differs",
      ],
      [dev, editService(local, "postgres", (s) => ({ ...s, networks: ["db", "edge"] })), "postgres: networks differs"],
      [dev, editService(local, "migrate", (s) => ({ ...s, mounts: [...s.mounts, TRUST] })), "migrate: mounts differs"],
      [
        dev,
        editService(local, "pds", (s) => ({ ...s, mounts: s.mounts.filter((m) => !same(m, TRUST)) })),
        "pds: an allowed local addition is missing",
      ],
      [
        dev,
        editService(local, "edge", (s) => ({ ...s, secrets: [...s.secrets, "pg_web_password"] })),
        "edge: secrets differs",
      ],
      [dev, editService(local, TOKEN_READER, (s) => ({ ...s, name: "reader2" })), "reader2 is only in the local file"],
      [
        { ...dev, services: [...dev.services, ...local.services.filter((s) => s.name === TOKEN_READER)] },
        local,
        `${TOKEN_READER} is in the dev file`,
      ],
      [
        dev,
        { ...local, networks: local.networks.map((n) => ({ ...n, internal: false })) },
        "the networks or their internal flags differ",
      ],
      // A PLC network the local-only list does not name (architecture 02:32Z).
      [
        dev,
        {
          ...editService(local, "web", (s) => ({ ...s, networks: [...s.networks, "plc_web"] })),
          networks: [...local.networks, { name: "plc_web", internal: true }],
        },
        "plc_web is not on the local-only list",
      ],
    ];
    for (const [d, l, problem] of cases) expect(drift(d, l), problem).toContain(problem);
  });

  test("a_changed_environment_or_env_file_is_named", () => {
    // verify-903-8b2abfc S1: each mutant that survived when environment and env_file were not compared.
    const setEnv = (s: Service, key: string, value: string): Service => ({
      ...s,
      environment: [...s.environment.filter(([k]) => k !== key), [key, { literal: value }]],
    });
    const withFile = (s: Service, path: string): Service => ({ ...s, envFiles: [...s.envFiles, path] });
    const pdsEnv = dev.services.find((s) => s.name === "pds")?.envFiles[0] ?? "";
    const cases: [service: string, key: string, value: string][] = [
      ["web", "NODE_TLS_REJECT_UNAUTHORIZED", "0"],
      ["pds", "NODE_TLS_REJECT_UNAUTHORIZED", "0"],
      ["web", "NODE_OPTIONS", "--max-old-space-size=384 --use-system-ca"],
      ["web", "NODE_OPTIONS", "--max-old-space-size=4096"],
      // An allowed key on a service item 11 does not name it for, or with another value.
      ["edge", "NODE_EXTRA_CA_CERTS", "/etc/unset-dev-trust/root.pem"],
      ["pds", "PDS_DID_PLC_URL", "http://plc:2583"],
      ["web", "UNSET_ENV", "prod"],
      // UNSET_ENV may become local only where dev sets it.
      ["edge", "UNSET_ENV", "local"],
    ];
    for (const [service, key, value] of cases) {
      const problem = `${service}: environment ${key} differs`;
      expect(
        drift(
          dev,
          editService(local, service, (s) => setEnv(s, key, value)),
        ),
        problem,
      ).toContain(problem);
    }
    // The other direction: a key only dev sets, and a repeated key in list form.
    const devTls = editService(dev, "web", (s) => setEnv(s, "NODE_TLS_REJECT_UNAUTHORIZED", "0"));
    expect(drift(devTls, local)).toContain("web: environment NODE_TLS_REJECT_UNAUTHORIZED differs");
    const repeated = editService(local, "web", (s) => ({
      ...s,
      environment: [...s.environment, ...s.environment.slice(0, 1)],
    }));
    expect(drift(dev, repeated)).toContain("web: environment repeats a key");
    expect(
      drift(
        editService(dev, "web", (s) => ({ ...s, environment: [...s.environment, ...s.environment.slice(0, 1)] })),
        local,
      ),
    ).toContain("web: environment repeats a key");
    // UNSET_ENV may become exactly local where dev sets it, as P1.34z will write it.
    expect(
      drift(
        dev,
        editService(local, "web", (s) => setEnv(s, "UNSET_ENV", "local")),
      ),
    ).toEqual([]);
    // env_file: pds.env given to a service without it, in either file, or renamed.
    expect(
      drift(
        dev,
        editService(local, "web", (s) => withFile(s, pdsEnv)),
      ),
    ).toContain("web: env_file differs");
    expect(
      drift(
        dev,
        editService(local, "edge", (s) => withFile(s, pdsEnv)),
      ),
    ).toContain("edge: env_file differs");
    expect(
      drift(
        editService(dev, "web", (s) => withFile(s, pdsEnv)),
        local,
      ),
    ).toContain("web: env_file differs");
    const renamed = editService(local, "pds", (s) => ({ ...s, envFiles: ["../../unset-dev-env/pds-local.env"] }));
    expect(drift(dev, renamed)).toContain("pds: env_file differs");
    // The folder must be the env directory, and the order is compared.
    const moved = editService(local, "pds", (s) => ({ ...s, envFiles: ["../../elsewhere/pds.env"] }));
    expect(drift(dev, moved)).toContain("pds: env_file differs");
    const devMoved = editService(dev, "pds", (s) => ({ ...s, envFiles: ["../../elsewhere/pds.env"] }));
    expect(drift(devMoved, local)).toContain("pds: env_file differs");
    const two = [`${ENV_DIR}/pds.env`, `${ENV_DIR}/pds-extra.env`];
    const swapped = drift(
      editService(dev, "pds", (s) => ({ ...s, envFiles: two })),
      editService(local, "pds", (s) => ({ ...s, envFiles: [...two].reverse() })),
    );
    expect(swapped).toContain("pds: env_file differs");
  });

  // P1.35r (verify-903-7742397 N-e, N-f): the env_file folder rule against weaker rewrites. A prefix or substring
  // match would pass the first two, and a rule that only compares local's folder with dev's would pass the third.
  const pdsEnvFile = (compose: Compose, path: string): Compose =>
    editService(compose, "pds", (s) => ({ ...s, envFiles: [path] }));
  test.each([
    { name: "an entry under a sub-folder", dev, local: pdsEnvFile(local, `${ENV_DIR}/sub/pds.env`) },
    { name: "an entry under a near-named folder", dev, local: pdsEnvFile(local, "../../unset-dev-env-old/pds.env") },
    {
      name: "both files moved to the same other folder",
      dev: pdsEnvFile(dev, "../../elsewhere/pds.env"),
      local: pdsEnvFile(local, "../../elsewhere/pds.env"),
    },
  ])("an_env_file_outside_the_env_folder_is_named: $name", ({ dev: d, local: l }) => {
    expect(drift(d, l)).toContain("pds: env_file differs");
  });

  test("the_app_site_and_its_two_keys_come_together", () => {
    // Step book 04:03Z: the edge's APP_HOST and APP_UPSTREAM exist only with item 12's app-site mount, and only so.
    const together = "edge: the app site and APP_HOST and APP_UPSTREAM do not come together";
    const setEnv = (s: Service, key: string, value: EnvValue): Service => ({
      ...s,
      environment: [...s.environment.filter(([k]) => k !== key), [key, value]],
    });
    const dropEnv = (s: Service, key: string): Service => ({
      ...s,
      environment: s.environment.filter(([k]) => k !== key),
    });
    const noSite = (s: Service): Service => ({ ...s, mounts: s.mounts.filter((m) => !same(m, APP_SITE.mount)) });
    const cases: [Compose, Compose, string][] = [
      [dev, editService(local, "edge", (s) => setEnv(s, "APP_UPSTREAM", { literal: "pds:3000" })), together],
      [dev, editService(local, "edge", (s) => setEnv(s, "APP_UPSTREAM", { literal: "web:8081" })), together],
      [dev, editService(local, "edge", (s) => setEnv(s, "APP_HOST", { literal: "app.unset.localhost" })), together],
      [dev, editService(local, "edge", (s) => dropEnv(s, "APP_UPSTREAM")), together],
      [dev, editService(local, "edge", (s) => dropEnv(dropEnv(s, "APP_HOST"), "APP_UPSTREAM")), together],
      [dev, editService(local, "edge", noSite), together],
      [
        dev,
        editService(local, "web", (s) => setEnv(s, "APP_HOST", { ref: "APP_HOST" })),
        "web: environment APP_HOST differs",
      ],
      [
        dev,
        editService(local, "pds", (s) => setEnv(s, "APP_UPSTREAM", { literal: "web:8080" })),
        "pds: environment APP_UPSTREAM differs",
      ],
      [
        editService(dev, "edge", (s) => setEnv(s, "APP_HOST", { ref: "APP_HOST" })),
        local,
        "edge: environment APP_HOST is in the dev file",
      ],
      [
        editService(dev, "web", (s) => setEnv(s, "APP_UPSTREAM", { literal: "web:8080" })),
        editService(local, "web", (s) => setEnv(s, "APP_UPSTREAM", { literal: "web:8080" })),
        "web: environment APP_UPSTREAM is in the dev file",
      ],
    ];
    for (const [d, l, problem] of cases) expect(drift(d, l), problem).toContain(problem);
    // Neither the mount nor the keys is consistent too; the site mount's absence is then the preflight's to judge.
    const bare = editService(local, "edge", (s) => noSite(dropEnv(dropEnv(s, "APP_HOST"), "APP_UPSTREAM")));
    expect(drift(dev, bare)).toEqual([]);
  });

  test("a_command_with_use_system_ca_is_refused_before_any_comparison", () => {
    // `command` is not a key compose-parse reads, so it is refused by name and never reaches the drift test.
    const text = readFileSync(join(DEPLOYMENT, "compose.local.yaml"), "utf8").replace(
      "      NODE_OPTIONS: --max-old-space-size=384\n",
      '      NODE_OPTIONS: --max-old-space-size=384\n    command: ["node", "--use-system-ca", "server.js"]\n',
    );
    expect(text).toContain("--use-system-ca");
    expect(() => parseCompose(text, "compose.local.yaml")).toThrow(/service key command/);
  });

  test("only_pds_and_web_trust_the_dev_root", () => {
    // Item 5: NODE_EXTRA_CA_CERTS names the bound root on pds and web in the local file, and nowhere else in either.
    const trusting = (compose: Compose) =>
      compose.services
        .filter((s) => s.environment.some(([key]) => key === "NODE_EXTRA_CA_CERTS"))
        .map((s) => [s.name, s.environment.find(([key]) => key === "NODE_EXTRA_CA_CERTS")?.[1]]);
    expect(trusting(local)).toEqual([
      ["pds", { literal: "/etc/unset-dev-trust/root.pem" }],
      ["web", { literal: "/etc/unset-dev-trust/root.pem" }],
    ]);
    expect(trusting(dev)).toEqual([]);
  });
});

/**
 * P1.35r I-2: a local-only service skips environmentDrift, since dev has nothing to compare it with, so a key that
 * changes its trust (TLS, app settings) or an env file could join it unseen. Its environment and env_file are pinned.
 */
describe("local-only services' environment and env_file (P1.35r I-2)", () => {
  const dev = parse("compose.dev.yaml");
  const local = parse("compose.local.yaml");
  const reader = (edit: (s: Service) => Service): Compose => editService(local, TOKEN_READER, edit);
  const readerService = local.services.find((s) => s.name === TOKEN_READER) as Service;
  const SECRET = "carries a secret other than as a /run/secrets file or a required reference";

  test.each([
    {
      name: "APP_HOST on the reader",
      local: reader((s) => ({ ...s, environment: [["APP_HOST", { ref: "APP_HOST" }]] })),
      problem: `${TOKEN_READER}: environment APP_HOST is not as pinned`,
    },
    {
      name: "NODE_TLS_REJECT_UNAUTHORIZED on the reader",
      local: reader((s) => ({ ...s, environment: [["NODE_TLS_REJECT_UNAUTHORIZED", { literal: "0" }]] })),
      problem: `${TOKEN_READER}: environment NODE_TLS_REJECT_UNAUTHORIZED is not as pinned`,
    },
    {
      name: "an unlisted env_file on the reader",
      local: reader((s) => ({ ...s, envFiles: [`${ENV_DIR}/pds.env`] })),
      problem: `${TOKEN_READER}: env_file is not as pinned`,
    },
    {
      name: "a repeated key on the reader",
      local: reader((s) => ({
        ...s,
        environment: [
          ["PORT", { literal: "1" }],
          ["PORT", { literal: "1" }],
        ],
      })),
      problem: `${TOKEN_READER}: environment repeats a key`,
    },
    {
      name: "a literal under a listed word on the reader",
      local: reader((s) => ({ ...s, environment: [["PLC_DB_PASSWORD", { literal: "literal" }]] })),
      problem: `${TOKEN_READER}: environment PLC_DB_PASSWORD ${SECRET}`,
    },
    {
      name: "a local-only service with no pin",
      local: { ...local, services: [...local.services, { ...readerService, name: "seed" }] },
      problem: "seed has no environment and env_file pin",
    },
    {
      name: "a pin whose service is gone",
      local: { ...local, services: local.services.filter((s) => s.name !== TOKEN_READER) },
      problem: `${TOKEN_READER} is pinned but not in the local file`,
    },
  ])("a_local_only_service_off_its_pin_is_named: $name", ({ local: changed, problem }) => {
    expect(drift(dev, changed)).toContain(problem);
  });

  test("a_secret_in_the_pin_is_refused", () => {
    // The same predicate holds in the pin as in compose (architecture 12:40Z), so no secret enters this file.
    expect(pinDrift(readerService, { PLC_DB_PASSWORD: "literal" }, [])).toContain(
      `${TOKEN_READER}: pin PLC_DB_PASSWORD ${SECRET}`,
    );
  });

  test("secret_bearing_values_only_as_files_or_required_references", () => {
    // Architecture 12:40Z (the record's section "Architecture on verify-910-a686fe0 S3"): the three accepted forms, and
    // keys outside the predicate. A key is secret-bearing by whole `_`-separated words, never by substring.
    const accepted: [string, string][] = [
      ["POSTGRES_PASSWORD_FILE", "/run/secrets/pg_superuser_password"],
      ["PG_PASSWORD_FILE", "/run/secrets/migrate_pg_password"],
      ["PLC_DB_PASSWORD", "${PLC_DB_PASSWORD:?set it in unset-dev-env}"],
      ["DATABASE_URL", "postgres://plc:${PLC_DB_PASSWORD:?set it}@plc-db/plc"],
      ["PORT", "2582"],
      ["PDS_DID_PLC_URL", "http://plc:2582"],
      ["KEYBOARD_LAYOUT", "literal"],
      ["PASSAGE", "literal"],
    ];
    for (const [key, value] of accepted) expect(secretRefusal(key, value), `${key}=${value}`).toBeNull();
  });

  test.each([
    // The step's minimum reds.
    { name: "a literal under a listed word", key: "PLC_DB_PASSWORD", value: "literal" },
    { name: "a default", key: "PLC_DB_PASSWORD", value: "${PLC_DB_PASSWORD:-x}" },
    { name: "a bare key", key: "PLC_DB_PASSWORD", value: null },
    { name: "a userinfo URL with a literal password", key: "DATABASE_URL", value: "postgres://plc:literal@plc-db/plc" },
    { name: "a *_FILE key outside /run/secrets/", key: "PG_PASSWORD_FILE", value: "/etc/pg_password" },
    // Each other refused form the ruling names.
    { name: "a plain reference", key: "PDS_JWT_SECRET", value: "${PDS_JWT_SECRET}" },
    { name: "a default without the colon", key: "API_TOKEN", value: "${API_TOKEN-x}" },
    { name: "an alternative", key: "API_TOKEN", value: "${API_TOKEN:+x}" },
    { name: "an alternative without the colon", key: "API_TOKEN", value: "${API_TOKEN+x}" },
    { name: "a required reference without a message", key: "API_TOKEN", value: "${API_TOKEN:?}" },
    { name: "a required reference without the colon", key: "API_TOKEN", value: "${API_TOKEN?set it}" },
    { name: "a reference nested in the message", key: "API_TOKEN", value: "${API_TOKEN:?$API_TOKEN_HINT}" },
    { name: "a required reference with a blank message", key: "API_TOKEN", value: "${API_TOKEN:? }" },
    { name: "an unbraced reference", key: "API_TOKEN", value: "$API_TOKEN" },
    { name: "a name not in capitals", key: "API_TOKEN", value: "${api_token:?set it}" },
    { name: "a composite", key: "SIGNING_KEY", value: "prefix-${SIGNING_KEY:?set it}" },
    { name: "a doubled dollar, which is a literal", key: "SIGNING_KEY", value: "$${SIGNING_KEY:?set it}" },
    { name: "a userinfo URL without a password part", key: "DATABASE_URL", value: "postgres://plc@plc-db/plc" },
    {
      name: "a reference as the user, with no password",
      key: "UPSTREAM",
      value: "https://${API_TOKEN:?set it}@plc-db/",
    },
    { name: "a userinfo URL whose password defaults", key: "DATABASE_URL", value: "postgres://plc:${P:-x}@plc-db/plc" },
    { name: "a userinfo URL with two references", key: "DATABASE_URL", value: "postgres://${U:?u}:${P:?p}@plc-db/plc" },
    {
      name: "a second userinfo URL with a literal password",
      key: "DATABASE_URL",
      value: "postgres://plc:${P:?p}@plc-db/plc?replica=postgres://plc:literal@plc-db-2/plc",
    },
    { name: "a userinfo URL under any key", key: "UPSTREAM", value: "https://plc:literal@plc-db/" },
    { name: "a *_FILE path that climbs out", key: "PG_PASSWORD_FILE", value: "/run/secrets/../pg_password" },
    { name: "a *_FILE path that is the folder", key: "PG_PASSWORD_FILE", value: "/run/secrets/" },
    { name: "a *_FILE path with a reference", key: "PG_PASSWORD_FILE", value: "/run/secrets/${PG_SECRET_NAME}" },
    { name: "a /run/secrets path on a key not *_FILE", key: "PLC_DB_PASSWORD", value: "/run/secrets/plc_db_password" },
    // A listed word in any case is still the word.
    { name: "a literal under a lower-case word", key: "plc_db_password", value: "literal" },
    // What the URL reading must not miss: a reference elsewhere, a question mark in a message, a URL in a message.
    {
      name: "a userinfo URL with an unbraced reference",
      key: "DATABASE_URL",
      value: "postgres://plc:${PLC_DB_PASSWORD:?set it}@plc-db/$PLC_DB",
    },
    {
      name: "a literal password after a message with a question mark",
      key: "DATABASE_URL",
      value: "postgres://${PLC_DB_USER:?who?}:literal@plc-db/plc",
    },
    {
      name: "a userinfo URL in a composite's message",
      key: "UPSTREAM",
      value: "x-${X:?postgres://plc:literal@plc-db}",
    },
    {
      name: "a value holding the mask character",
      key: "DATABASE_URL",
      value: "postgres://plc:\u0000@plc-db/plc?db=${PLC_DB_PASSWORD:?set it}",
    },
  ])("a_secret_bearing_value_is_refused: $name", ({ key, value }) => {
    expect(secretRefusal(key, value)).toBe(`${key} ${SECRET}`);
  });
});

/**
 * Item 12: the whole preflight on the real compose.local.yaml under --env local, which admits builds, must pass. The
 * checkout is this one, read as the deploy user's; its sibling folders are virtual and hold what the runbook puts there
 * (docs/human/runbooks/dev-stack-secrets.md), with a throwaway dev root and leaf made by openssl as the runbook does.
 */
describe("compose.local.yaml under the whole preflight (P1.34d item 12)", () => {
  const CHECKOUT = resolve(DEPLOYMENT, "..");
  const beside = (name: string) => join(dirname(CHECKOUT), name);
  const APP = "app.unset.localhost";
  const PDS = "pds.unset.localhost";
  const DEPLOY_UID = 4242;
  const DEV = 0x7fff0002;
  let pki = "";
  const files = new Map<string, { kind: "dir" | "file"; mode: number; uid: number; text?: string; names?: string[] }>();

  beforeAll(() => {
    pki = mkdtempSync(join(tmpdir(), "compose-local-"));
    const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: pki, stdio: "ignore" });
    const key = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
    openssl(
      ...["req", "-x509", ...key, "-keyout", "root.key", "-out", "root.pem", "-days", "30", "-subj", "/CN=root"],
      ...["-addext", "basicConstraints=critical,CA:TRUE,pathlen:0"],
      ...["-addext", "keyUsage=critical,keyCertSign,cRLSign"],
      ...[
        "-addext",
        `nameConstraints=critical,permitted;DNS:${APP},permitted;DNS:${PDS},excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::`,
      ],
    );
    openssl(
      ...["req", "-x509", ...key, "-keyout", "leaf.key", "-out", "leaf.pem", "-days", "30", "-subj", `/CN=${APP}`],
      ...["-CA", "root.pem", "-CAkey", "root.key", "-addext", "basicConstraints=critical,CA:FALSE"],
      ...["-addext", `subjectAltName=DNS:${APP},DNS:${PDS}`, "-addext", "extendedKeyUsage=serverAuth"],
    );
    const pem = (name: string) => readFileSync(join(pki, name), "utf8");
    const dir = (path: string, mode: number, names: string[]) =>
      files.set(beside(path), { kind: "dir", mode, uid: DEPLOY_UID, names });
    const file = (path: string, mode: number, text = "fixture\n", uid = DEPLOY_UID) =>
      files.set(beside(path), { kind: "file", mode, uid, text });
    const secrets = parse("compose.local.yaml").secretFiles.map((path) => path.split("/").at(-1) as string);
    const owner = (name: string) => (name.startsWith("pg_superuser") || /^pg_(migrator|tap)_/.test(name) ? 999 : 65532);
    dir("unset-dev-secrets", 0o700, secrets);
    for (const name of secrets) file(`unset-dev-secrets/${name}`, 0o400, "fixture\n", owner(name));
    dir("unset-dev-env", 0o700, ["dev-public.env", "pds.env", "local-leaf.pem"]);
    file(
      "unset-dev-env/dev-public.env",
      0o600,
      [
        `WEB_PUBLIC_ORIGIN=https://${APP}`,
        `WEB_ALLOWED_HOSTS=${APP}`,
        "WEB_MEDIA_ORIGIN=https://media.example.net",
        `APP_HOST=${APP}`,
        `PDS_HOSTNAME=${PDS}`,
        `PDS_SERVICE_HANDLE_DOMAINS=.${PDS}`,
        "EDGE_ACME_EMAIL=edge@example.test",
        "",
      ].join("\n"),
    );
    // The template with its two checked placeholders filled: a recovery did:key built here (as preflight.test.ts does,
    // so no key-shaped string sits in the file) and an admin password of 32 characters.
    const recovery = `did:key:z${base58([0xe7, 0x01, 0x02, ...Array.from({ length: 32 }, (_, i) => i + 1)])}`;
    const pdsEnv = readFileSync(join(DEPLOYMENT, "env/pds.example.env"), "utf8")
      .replace("PDS_RECOVERY_DID_KEY=replace-me", `PDS_RECOVERY_DID_KEY=${recovery}`)
      .replace("PDS_ADMIN_PASSWORD=replace-me", `PDS_ADMIN_PASSWORD=${"x".repeat(32)}`);
    file("unset-dev-env/pds.env", 0o600, pdsEnv);
    file("unset-dev-env/local-leaf.pem", 0o644, pem("leaf.pem"));
    dir("unset-dev-trust", 0o755, ["root.pem"]);
    file("unset-dev-trust/root.pem", 0o644, pem("root.pem"));
    dir("unset-dev-ca", 0o700, ["root.key", "root.pem"]);
    file("unset-dev-ca/root.key", 0o400);
    file("unset-dev-ca/root.pem", 0o600, pem("root.pem"));
  });
  afterAll(() => rmSync(pki, { recursive: true, force: true }));

  const inCheckout = (path: string) => path === CHECKOUT || path.startsWith(`${CHECKOUT}/`);
  const aboveCheckout = (path: string) => path === "/" || CHECKOUT.startsWith(`${path}/`);
  /** A stat of a virtual entry; a copy of a real one, so the methods are Node's. */
  const made = (kind: "dir" | "file", mode: number, uid: number, ino: number): Stats =>
    Object.assign(lstatSync(DEPLOYMENT), {
      mode: (kind === "dir" ? 0o040000 : 0o100000) | mode,
      uid,
      size: kind === "dir" ? 4096 : 24,
      nlink: kind === "dir" ? 2 : 1,
      dev: DEV,
      ino,
    });
  const look = (read: (path: string) => Stats) => (path: string) => {
    const entry = files.get(path);
    if (entry !== undefined) return made(entry.kind, entry.mode, entry.uid, 1 + [...files.keys()].indexOf(path));
    if (aboveCheckout(path)) return made("dir", 0o755, 0, 100 + path.length);
    if (!inCheckout(path)) return null;
    try {
      const info = read(path);
      // The checkout as the deploy user's, with no group or other write.
      return Object.assign(info, { uid: DEPLOY_UID, mode: info.mode & ~0o022 });
    } catch {
      return null;
    }
  };
  const real = <T>(path: string, read: () => T): T | null => {
    if (!inCheckout(path)) return null;
    try {
      return read();
    } catch {
      return null;
    }
  };

  const realLocalArgs = () => [
    "--env",
    "local",
    "--compose",
    join(DEPLOYMENT, "compose.local.yaml"),
    "--interpolation-env",
    beside("unset-dev-env/dev-public.env"),
  ];
  const realLocalDeps = (): Deps => ({
    root: CHECKOUT,
    run: async (file) =>
      file === "timedatectl"
        ? { code: 0, stdout: "yes\n", stderr: "" }
        : file === "docker"
          ? {
              code: 0,
              stdout: JSON.stringify({ mediaType: "application/vnd.oci.image.index.v1+json" }),
              stderr: "",
            }
          : { code: 0, stdout: "", stderr: "" },
    readText: (path) => files.get(path)?.text ?? real(path, () => readFileSync(path, "utf8")),
    readEnv: (path) => {
      const entry = files.get(path);
      return entry?.text === undefined
        ? null
        : { text: entry.text, id: `${DEV}:${[...files.keys()].indexOf(path) + 1}` };
    },
    readdir: (path) => {
      const names = files.get(path)?.names;
      if (names !== undefined) return names.map((name) => Buffer.from(name));
      throw new Error("no such folder");
    },
    lstat: look(lstatSync),
    stat: look(statSync),
    realpath: (path) => (files.has(path) || aboveCheckout(path) ? path : real(path, () => realpathSync.native(path))),
    readlink: (path) => readlinkSync(path),
    statfs: () => ({ type: 0xef53 }),
    uid: DEPLOY_UID,
    environment: {},
  });

  test("compose_local_pds_neighbours_pass", () => {
    // The neighbour rule C17 runs at deploy, on the real local file with the real base lock (#742 item 11; verify-895
    // F2), through the inputs form P1.35o gave pdsNeighbours.
    expect(pdsNeighbours(loadInputs(realLocalArgs(), realLocalDeps()).inputs)).toEqual([]);
  });

  test("preflight_passes_the_real_local_file", async () => {
    const result = await preflight(realLocalArgs(), realLocalDeps());
    expect(result.lines.filter((line) => !/^(PASS|UNSIGNED) /.test(line))).toEqual([
      "LOCAL unsigned, local-only stack: never deploy it",
    ]);
    expect(result.code).toBe(0);
  });
});
