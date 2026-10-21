// The compose files and env files, read the way the preflight checks them (P1.30). The script parses them itself and
// never runs `docker compose config`, which prints every interpolated secret. It takes a strict subset of YAML
// (architecture record 2026-10-07-p130-preflight-location-and-yaml): one document, no anchor, alias, merge key or
// explicit tag, no duplicate key, no top-level `include`, no `extends`, and no interpolation in a field that bears on
// security. Anything outside the subset is refused, never interpreted, so the preflight cannot read a file one way
// while Compose reads it another (preflight_matches_compose_config checks the rest against Compose in CI).
// yaml 2.9.1 (node_modules/yaml, docs at eemeli.org/yaml): parseAllDocuments, visit, LineCounter.
// Compose: compose-spec 05-services.md ("ports", "env_file", "Env_file format", "networks", "network_mode"),
// 06-networks.md and 12-interpolation.md. Networks (P1.30t, architecture record
// 2026-10-07-p130s-networks-and-caddyfile-reader) are read as Compose v5.3.1 `config` reports them: a service with no
// `networks` key and no `network_mode` joins `default`, and a declared network is listed whether or not one joins it.
import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  type Node,
  parseAllDocuments,
  type Scalar,
  visit,
  type YAMLMap,
} from "yaml";

/** A published port; `hostIp` null binds every interface, `published` null lets the engine pick the host port. */
export type Port = { hostIp: string | null; published: string | null; target: string };
/** An environment value: literal text, or a whole `${NAME}` taken from the project's `.env`. */
export type EnvValue = { literal: string } | { ref: string };
export type Service = {
  name: string;
  image: string | null;
  envFiles: string[];
  environment: [string, EnvValue][];
  ports: Port[];
  /** The networks the service joins, by their key in the file. */
  networks: string[];
  networkMode: string | null;
  /** The service's `volumes`; a bind source is as written, relative to the project directory (the first file's). */
  mounts: Mount[];
  hardening: Hardening;
  /** `build` as written: the context relative to the project directory, the Dockerfile relative to the context. */
  build: Build | null;
  tmpfs: Tmpfs[];
  dependsOn: Dependency[];
  /** Declared secret names; Compose mounts each at /run/secrets/<name>. */
  secrets: string[];
  /** `profiles`: empty, or exactly ["tools"] on a service with `network_mode: none` (P1.29h). */
  profiles: string[];
  /** `logging`: null, or "none" on the token reader, which must set it (P1.29h, Amendment 2 B1). */
  logging: "none" | null;
};
export type Build = { context: string; dockerfile: string };
export type Tmpfs = { target: string; options: string | null };
export type Dependency = { service: string; condition: string };
/**
 * The hardening and limit keys (P1.30x), each null or empty when the service leaves it out. Values are as written: a
 * dev contract that they be present and sized lives in that environment's compose tests, not here.
 */
export type Hardening = {
  readOnly: boolean | null;
  capDrop: string[];
  capAdd: string[];
  securityOpt: string[];
  user: string | null;
  memLimit: string | null;
  cpus: number | null;
  pidsLimit: number | null;
  restart: string | null;
};
/** One entry of a service's `volumes` (compose-spec 05-services.md "volumes"), in the strict subset. */
export type Mount = { type: "bind" | "volume" | "tmpfs"; source: string | null; target: string; readOnly: boolean };
/**
 * A top-level network: only `internal`, a `bridge` driver and an `ipam` of exactly one IPv4 subnet are read; anything
 * else is refused. `subnet` is null when the engine picks it.
 */
export type Network = { name: string; internal: boolean; subnet: string | null };
export type Compose = {
  name: string | null;
  services: Service[];
  networks: Network[];
  secretFiles: string[];
  /** Each top-level secret's file, by name: what a service's `secrets` entry mounts (P1.30o). */
  secretFileByName: ReadonlyMap<string, string>;
};

export class ParseError extends Error {}

const OPTIONS = { version: "1.2", schema: "core", uniqueKeys: true, merge: false, strict: true } as const;
/** Service fields where a `$` would let the environment change what runs (the ruling's list). */
const NO_INTERPOLATION = [
  "image",
  "privileged",
  "cap_add",
  "cap_drop",
  "security_opt",
  "user",
  "mem_limit",
  "cpus",
  "pids_limit",
  "restart",
  "network_mode",
  "pid",
  "ipc",
  "ports",
  "volumes",
  "devices",
  "read_only",
  "env_file",
  "build",
  "tmpfs",
  "depends_on",
  "secrets",
  "profiles",
];
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Line-aware helpers over one parsed file: every refusal names the file and line. */
type Reader = {
  fail(node: unknown, why: string): never;
  /** A scalar's text as Compose reads it; a number or boolean must be written in its one canonical form. */
  text(node: unknown, what: string): string;
  list(node: unknown, what: string): unknown[];
  noDollar(node: unknown, what: string): void;
  /** The scalar's text as a path, refusing a leading `~` and any `$` (`isHomeOrInterpolated`). */
  path(node: unknown, what: string): string;
};

function reader(file: string, lines: LineCounter): Reader {
  const fail = (node: unknown, why: string): never => {
    const range = (node as Node | null | undefined)?.range;
    throw new ParseError(`${range ? `${file}:${lines.linePos(range[0]).line}` : file}: ${why}`);
  };
  const text = (node: unknown, what: string): string => {
    if (!isScalar(node)) return fail(node, `${what} is not a scalar`);
    const scalar = node as Scalar;
    if (typeof scalar.value === "string") return scalar.value;
    const canonical = String(scalar.value);
    return scalar.value !== null && canonical === scalar.source ? canonical : fail(scalar, `${what} is ambiguous`);
  };
  const list = (node: unknown, what: string): unknown[] => {
    if (node === undefined) return [];
    if (isSeq(node)) return node.items;
    return isScalar(node) ? [node] : fail(node, `${what} is not a list`);
  };
  const noDollar = (node: unknown, what: string): void => {
    visit(node as Node, { Scalar: (_, s) => void (String(s.value ?? "").includes("$") && fail(s, `$ in ${what}`)) });
  };
  const path = (node: unknown, what: string): string => {
    const value = text(node, what);
    return isHomeOrInterpolated(value) ? fail(node, `${what}: a leading ~ or a $ is refused`) : value;
  };
  return { fail, text, list, noDollar, path };
}

/**
 * A path Compose would read from the environment: a leading `~` it expands from $HOME (compose-go paths/home.go, v2.7.1
 * and v2.13.0) or any `$` it interpolates (12-interpolation.md). Refused in every path field, so the preflight never
 * resolves a path Compose reads another way (P1.30a; architecture ruling 2026-10-12-preflight-compose-inputs, F2).
 */
export const isHomeOrInterpolated = (path: string): boolean => path.startsWith("~") || path.includes("$");

export function parseCompose(text: string, file: string): Compose {
  const lines = new LineCounter();
  const r = reader(file, lines);
  const doc = strictDocument(text, file, lines, r);
  const root = doc.contents;
  if (!isMap(root)) return r.fail(root, "the file is not a mapping");
  if (root.has("include")) r.fail(root.get("include", true), "include");
  for (const pair of root.items) {
    const key = r.text(pair.key, "top-level key");
    if (!TOP_LEVEL_KEYS.has(key)) r.fail(pair.key, `top-level key ${key}`);
  }
  const volumes = namedVolumes(r, root.get("volumes", true));
  const secrets = secretFiles(r, root.get("secrets", true));
  const name = root.get("name", true);
  if (name !== undefined) r.noDollar(name, "name");
  const servicesNode = root.get("services", true);
  if (!isMap(servicesNode)) return r.fail(servicesNode, "services is not a mapping");
  const scope: Scope = {
    volumes,
    secrets: new Set(secrets.keys()),
    services: new Set(servicesNode.items.map((pair) => r.text(pair.key, "service name"))),
  };
  return {
    name: name === undefined ? null : r.text(name, "name"),
    services: servicesNode.items.map((pair) => service(r, r.text(pair.key, "service name"), pair.value, scope)),
    networks: networks(r, root.get("networks", true)),
    secretFiles: [...secrets.values()],
    secretFileByName: secrets,
  };
}

/**
 * The only top-level keys accepted: the ones `parseCompose` reads or already refuses (P1.30k, step book record
 * 2026-10-12-p130k-compose-top-level-allowlist, amendments 1 and 2). `include` is listed only because its own refusal
 * above answers first; `configs` or an `x-` extension would carry text no check reads, so any other key is refused by
 * name.
 */
const TOP_LEVEL_KEYS = new Set(["name", "services", "networks", "volumes", "secrets", "include"]);

/**
 * Top-level `volumes:`, which Compose requires for every named volume a service mounts (05-services.md "volumes",
 * 07-volumes.md). A volume is declared by name alone: `driver`, `driver_opts` (a `local` driver with `o: bind` mounts
 * any host path), `external`, `name` and `labels` all decide where the data lives, so each is refused by name.
 */
function namedVolumes(r: Reader, node: unknown): Set<string> {
  if (node === undefined) return new Set();
  if (!isMap(node)) r.fail(node, "volumes is not a mapping");
  return new Set(
    node.items.map((pair) => {
      const name = r.text(pair.key, "volume name");
      if (!VOLUME_NAME.test(name)) r.fail(pair.key, `volume name ${name} is refused`);
      if (isEmpty(pair.value)) return name;
      if (!isMap(pair.value)) r.fail(pair.value, `volume ${name} is not a mapping`);
      const [setting] = pair.value.items;
      if (setting !== undefined) r.fail(setting.key, `volume ${name}: ${r.text(setting.key, "volume setting")}`);
      return name;
    }),
  );
}

/** `$NAME` or `${NAME...}`, the forms Compose interpolates (12-interpolation.md); `$$` is removed first. */
const INTERPOLATED = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/g;

/**
 * Every name the file interpolates, in any key or value and inside a default (`${A:-$B}` names both), so the preflight
 * can refuse to run when one is set in its environment: Compose would take that value over the env file (P1.30a, F3.4).
 */
export function interpolatedNames(text: string, file: string): string[] {
  const names = new Set<string>();
  const lines = new LineCounter();
  visit(strictDocument(text, file, lines, reader(file, lines)), {
    Scalar: (_, scalar) => {
      for (const [, braced, bare] of String(scalar.value ?? "")
        .replaceAll("$$", "")
        .matchAll(INTERPOLATED)) {
        names.add((braced ?? bare) as string);
      }
    },
  });
  return [...names];
}

/** A small data file (the retirement report, JSON being YAML 1.2) read under the same strict subset as Compose. */
export function parseStrictData(text: string, file: string): unknown {
  const lines = new LineCounter();
  return strictDocument(text, file, lines, reader(file, lines)).toJS();
}

/** One YAML document in the strict subset: no second document, error, alias, anchor, explicit tag or merge key. */
function strictDocument(text: string, file: string, lines: LineCounter, r: Reader): Document {
  const docs = parseAllDocuments(text, { ...OPTIONS, lineCounter: lines });
  if (!Array.isArray(docs) || docs.length !== 1) throw new ParseError(`${file}: not exactly one YAML document`);
  const [doc] = docs as [(typeof docs)[number]];
  const [error] = doc.errors;
  if (error !== undefined) throw new ParseError(`${file}:${lines.linePos(error.pos[0]).line}: ${error.code}`);
  visit(doc, {
    Alias: (_, node) => r.fail(node, "alias"),
    Node: (_, node) => {
      if (node.anchor) r.fail(node, "anchor");
      if (node.tag) r.fail(node, "explicit tag");
    },
    Pair: (_, pair) => {
      if (isScalar(pair.key) && pair.key.value === "<<") r.fail(pair.key, "merge key");
    },
  });
  refuseAliasesByOption(doc, file);
  return doc;
}

/**
 * The second layer behind the walk's alias refusal (P1.30 core): yaml reads `maxAliasCount` only as a `toJS` option,
 * never as a parse option (yaml 2.9.1 dist/doc/Document.js:293), and with 0 it resolves no alias at all
 * (dist/nodes/Alias.js:24). Converting once here makes the limit real even if the walk ever misses an alias.
 */
export function refuseAliasesByOption(doc: Document, file: string): void {
  try {
    doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ParseError(`${file}: alias (${error instanceof Error ? error.message : "refused"})`);
  }
}

/**
 * The only service keys accepted: the ones `service` reads (P1.30w, architecture ruling B1). A key it never reads
 * could change what runs while every check passes (`configs`, `secrets` or `tmpfs` over /etc/caddy, `entrypoint`,
 * `command`, `extends`, or `volumes_from` bringing another service's mounts), so any other key is refused by name.
 * Later keys come one at a time, each with a ruling, in the step that first needs it: P1.30x added the hardening and
 * limit keys, and P1.30y build, tmpfs, depends_on and short-form secrets (architecture record
 * 2026-10-12-p129-compose-service-keys).
 */
const SERVICE_KEYS = new Set([
  "image",
  "env_file",
  "environment",
  "ports",
  "networks",
  "network_mode",
  "volumes",
  "read_only",
  "cap_drop",
  "cap_add",
  "security_opt",
  "user",
  "mem_limit",
  "cpus",
  "pids_limit",
  "restart",
  "build",
  "tmpfs",
  "depends_on",
  "secrets",
  "profiles",
  "logging",
]);

/** What a service may name in its own file: named volumes, top-level secrets and other services. */
type Scope = { volumes: ReadonlySet<string>; secrets: ReadonlySet<string>; services: ReadonlySet<string> };

function service(r: Reader, name: string, spec: unknown, scope: Scope): Service {
  if (!isMap(spec)) return r.fail(spec, `service ${name} is not a mapping`);
  for (const pair of spec.items) {
    const key = r.text(pair.key, "service key");
    if (!SERVICE_KEYS.has(key)) r.fail(pair.key, `service key ${key}`);
  }
  for (const field of NO_INTERPOLATION) if (spec.has(field)) r.noDollar(spec.get(field, true), field);
  const image = spec.get("image", true);
  return {
    name,
    image: image === undefined ? null : r.text(image, "image"),
    envFiles: r.list(spec.get("env_file", true), "env_file").map((n) => r.path(n, "env_file")),
    environment: environment(r, spec.get("environment", true), name),
    ports: r.list(spec.get("ports", true), "ports").map((n) => port(r, n)),
    networks: serviceNetworks(r, spec.get("networks", true), spec.has("network_mode"), name),
    networkMode: spec.has("network_mode") ? r.text(spec.get("network_mode", true), "network_mode") : null,
    mounts: r.list(spec.get("volumes", true), "volumes").map((n) => declared(r, mount(r, n), n, scope.volumes)),
    hardening: hardening(r, spec),
    build: build(r, spec.get("build", true)),
    tmpfs: tmpfs(r, spec.get("tmpfs", true)),
    dependsOn: dependsOn(r, spec.get("depends_on", true), scope.services),
    secrets: serviceSecrets(r, spec.get("secrets", true), scope.secrets),
    profiles: profiles(r, spec),
    logging: logging(r, name, spec),
  };
}

/**
 * `profiles` keeps a service out of `docker compose up` until it is named (compose-spec 15-profiles.md). The only one
 * is the local token reader's: exactly `[tools]`, on a service with no network at all (architecture record
 * 2026-10-13-p129h-local-token-reader, Amendment 1 item 2).
 */
function profiles(r: Reader, spec: YAMLMap): string[] {
  const node = spec.get("profiles", true);
  if (node === undefined) return [];
  const values = isSeq(node) ? node.items.map((item) => r.text(item, "profile")) : [];
  if (values.length !== 1 || values[0] !== "tools") r.fail(node, "profiles must be exactly [tools]");
  const mode = spec.get("network_mode", true);
  if (mode === undefined || r.text(mode, "network_mode") !== "none") {
    r.fail(node, "a service with profiles must set network_mode: none");
  }
  return ["tools"];
}

/**
 * The one service that may set `logging`, and must: its stdout is the email token (P1.29h). It is also the one service
 * that may run the node base unbuilt (C2 under local, and compose.dev.test.ts).
 */
export const TOKEN_READER = "pds-token-reader";

/**
 * `logging` exactly `{driver: none}`, on the token reader only, which must set it: with driver none Docker keeps no
 * log of the token, while `compose run`'s attached stdout still reaches the caller (architecture record
 * 2026-10-13-p129h-local-token-reader, Amendment 2, B1). Any other driver or any option is refused.
 */
function logging(r: Reader, name: string, spec: YAMLMap): "none" | null {
  const node = spec.get("logging", true);
  if (node === undefined) {
    if (name === TOKEN_READER) r.fail(spec, `${TOKEN_READER} must set logging: {driver: none}`);
    return null;
  }
  if (name !== TOKEN_READER) r.fail(node, `logging is allowed only on ${TOKEN_READER}`);
  const driver = isMap(node) && node.items.length === 1 ? node.get("driver", true) : undefined;
  if (driver === undefined || r.text(driver, "logging driver") !== "none") {
    r.fail(node, "logging must be exactly {driver: none}");
  }
  return "none";
}

/**
 * `build` in its long form with exactly `context` and `dockerfile`, kept as written; C26 resolves and judges them.
 * `target` would pick a stage the "last stage ships" tests never check, and every other build key changes what is
 * built, so each is refused by name.
 */
function build(r: Reader, node: unknown): Build | null {
  if (node === undefined) return null;
  if (!isMap(node)) return r.fail(node, "build is not {context, dockerfile}");
  for (const pair of node.items) {
    const key = r.text(pair.key, "build key");
    if (key !== "context" && key !== "dockerfile") r.fail(pair.key, `build key ${key}`);
  }
  const context = node.get("context", true);
  const dockerfile = node.get("dockerfile", true);
  if (context === undefined || dockerfile === undefined) return r.fail(node, "build is not {context, dockerfile}");
  const contextText = r.text(context, "build context");
  if (!LOCAL_CONTEXT.test(contextText)) r.fail(context, "build context is not a local path");
  // A leading ~ may name a home directory rather than a path under the context, so r.path refuses it, not guesses.
  return { context: contextText, dockerfile: r.path(dockerfile, "build dockerfile") };
}

/**
 * A context written as a path (`.`, `..`, or starting `./`, `../` or `/`) with no `:` or `#`: compose-go passes a URL
 * or git context (`https://…`, `git@…:…`, `github.com/…`, a `#ref` fragment) through unresolved, so it is refused, not
 * resolved.
 */
const LOCAL_CONTEXT = /^(?:\.\.?|\.\.?\/[^:#]*|\/[^:#]*)$/;

/** The only tmpfs targets, in either form; a later one needs a ruling. C27 keeps the socket directory to postgres. */
export const TMPFS_TARGETS = ["/tmp", "/var/run/postgresql"];
const TMPFS_WHY = "target is not /tmp or /var/run/postgresql";
const TMPFS_OPTION = /^(?:(?:uid|gid)=[0-9]+|mode=[0-7]{3,4}|size=[1-9][0-9]*[kmg]?|noexec|nosuid|nodev)$/;

/** `tmpfs` as a list of TARGET or TARGET:OPTIONS (05-services.md "tmpfs"), with only the ruling's options. */
function tmpfs(r: Reader, node: unknown): Tmpfs[] {
  if (node === undefined) return [];
  if (!isSeq(node)) return r.fail(node, "tmpfs is not a list");
  return node.items.map((item) => {
    const [target = "", ...rest] = r.text(item, "tmpfs").split(":");
    const options = rest.length === 0 ? null : rest.join(":");
    if (!TMPFS_TARGETS.includes(target)) r.fail(item, `tmpfs ${TMPFS_WHY}`);
    if (options !== null && !options.split(",").every((option) => TMPFS_OPTION.test(option))) {
      r.fail(item, "tmpfs option is refused");
    }
    return { target, options };
  });
}

const CONDITIONS = ["service_started", "service_healthy", "service_completed_successfully"];
const CONDITIONS_TEXT = "service_started, service_healthy or service_completed_successfully";

/**
 * `depends_on` as a list of names, which Compose reads as `service_started`, or a map of name to `{condition}`.
 * `required: false` would let a service start without what it waits on, and `restart` couples restarts, so both are
 * refused; every name is a service in the same file.
 */
function dependsOn(r: Reader, node: unknown, services: ReadonlySet<string>): Dependency[] {
  if (node === undefined) return [];
  let entries: [unknown, string, string][];
  if (isSeq(node)) entries = node.items.map((n) => [n, r.text(n, "depends_on"), "service_started"]);
  else if (isMap(node)) entries = node.items.map((p) => [p.key, r.text(p.key, "depends_on"), condition(r, p.value)]);
  else return r.fail(node, "depends_on is not a list or mapping");
  return entries.map(([n, service, condition]) => {
    if (!services.has(service)) r.fail(n, "depends_on names a service not in this file");
    return { service, condition };
  });
}

function condition(r: Reader, node: unknown): string {
  if (!isMap(node)) return r.fail(node, "depends_on entry is not {condition}");
  for (const pair of node.items) {
    const key = r.text(pair.key, "depends_on key");
    if (key !== "condition") r.fail(pair.key, `depends_on key ${key}`);
  }
  const value = node.get("condition", true);
  if (value === undefined) return r.fail(node, "depends_on entry is not {condition}");
  const text = r.text(value, "condition");
  return CONDITIONS.includes(text) ? text : r.fail(value, `depends_on condition is not ${CONDITIONS_TEXT}`);
}

/** A secret name whose fixed target, /run/secrets/<name>, cannot leave that directory. */
const SECRET_NAME = /^[a-z0-9_]+$/;

/**
 * Service `secrets` in the short form only: the long form's `target` could mount a secret over /etc/caddy or anything
 * else (ruling B1). Each name is declared in the same file's top-level `secrets`.
 */
function serviceSecrets(r: Reader, node: unknown, declared: ReadonlySet<string>): string[] {
  if (node === undefined) return [];
  if (!isSeq(node)) return r.fail(node, "secrets is not a list");
  return node.items.map((item) => {
    if (!isScalar(item)) return r.fail(item, "secrets long form is refused");
    const name = r.text(item, "secret");
    if (!SECRET_NAME.test(name)) r.fail(item, "secret name is refused");
    if (!declared.has(name)) r.fail(item, "secret is not declared");
    return name;
  });
}

/** A numeric UID or UID:GID, neither 0: a name resolves inside the image, where the preflight cannot see it. */
const USER = /^[1-9][0-9]*(?::[1-9][0-9]*)?$/;
const MEM_LIMIT = /^[1-9][0-9]*[mg]$/;
const CPUS = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
/** The pid space is the host's whatever its size, and no service needs more (Codex ruling 2, batch 33). */
const PIDS_MAX = 4096;
const RESTART = ["no", "on-failure", "unless-stopped", "always"];

/**
 * The hardening and limit keys, each in one shape (architecture record 2026-10-12-p129-compose-service-keys). The
 * capability and option lists must be exactly the safe value, so a partial drop or an unconfined profile is refused,
 * never read; cap_add's "only on the edge image" half needs the lock, so C25 checks it.
 */
function hardening(r: Reader, spec: YAMLMap): Hardening {
  const node = (key: string) => spec.get(key, true);
  const scalar = (key: string, ok: (text: string) => boolean, why: string): string | null => {
    if (!spec.has(key)) return null;
    const text = r.text(node(key), key);
    return ok(text) ? text : r.fail(node(key), `${key} ${why}`);
  };
  const capDrop = exactList(r, node("cap_drop"), "cap_drop", "ALL");
  const capAdd = exactList(r, node("cap_add"), "cap_add", "NET_BIND_SERVICE");
  if (capAdd.length > 0 && capDrop.length === 0) r.fail(node("cap_add"), "cap_add without cap_drop [ALL]");
  return {
    readOnly: readOnlyFlag(r, node("read_only")),
    capDrop,
    capAdd,
    securityOpt: exactList(r, node("security_opt"), "security_opt", "no-new-privileges:true"),
    // Compose takes `user` only as a string ("services.x.user must be a string", Compose v5.6.0).
    user: scalar("user", (t) => USER.test(t) && isString(node("user")), "is not a non-zero UID[:GID] string"),
    memLimit: scalar("mem_limit", (t) => MEM_LIMIT.test(t), "is not a size in m or g"),
    cpus: cpus(r, node("cpus")),
    pidsLimit: pidsLimit(r, node("pids_limit")),
    restart: scalar("restart", (t) => RESTART.includes(t), "is not no, on-failure, unless-stopped or always"),
  };
}

const isString = (node: unknown): boolean => isScalar(node) && typeof node.value === "string";

/**
 * A positive CPU count. A number is read from its source text: the canonical-form check would call `2.0` ambiguous,
 * yet Compose reads it as the number 2 (Codex 4249566407; phase-4.md plans `cpus: 2.0`).
 */
function cpus(r: Reader, node: unknown): number | null {
  if (node === undefined) return null;
  const text = isScalar(node) && typeof node.value === "number" ? (node as Scalar).source : r.text(node, "cpus");
  // A decimal of about 310 digits matches CPUS yet reads as Infinity, so the value must be finite as well.
  const value = typeof text === "string" && CPUS.test(text) ? Number(text) : Number.NaN;
  if (!(Number.isFinite(value) && value > 0)) return r.fail(node, "cpus is not a positive number");
  // Compose sends int64(cpus * 1e9) NanoCPUs from a float32 (docker/compose v5.6.0 pkg/compose/create.go:758;
  // compose-go v2.16.1 types/types.go CPUS), and the engine reads 0 as no limit (moby v28.5.1
  // daemon/daemon_unix.go:505), so a tiny value would silently mean none; 0.01 is the smallest the engine names.
  return value >= MIN_CPUS ? value : r.fail(node, "cpus is below 0.01");
}
const MIN_CPUS = 0.01;

/** A positive integer up to PIDS_MAX; 0 and -1 would mean no limit at all. */
function pidsLimit(r: Reader, node: unknown): number | null {
  if (node === undefined) return null;
  const value = isScalar(node) ? node.value : null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > PIDS_MAX) {
    return r.fail(node, "pids_limit is not an integer from 1 to 4096");
  }
  r.text(node, "pids_limit");
  return value;
}

/** A list that is absent or exactly `[only]`. */
function exactList(r: Reader, node: unknown, key: string, only: string): string[] {
  if (node === undefined) return [];
  if (!isSeq(node)) return r.fail(node, `${key} is not a list`);
  const items = node.items.map((item) => r.text(item, key));
  return items.length === 1 && items[0] === only ? items : r.fail(node, `${key} is not [${only}]`);
}

function readOnlyFlag(r: Reader, node: unknown): boolean | null {
  if (node === undefined) return null;
  if (!isScalar(node) || typeof node.value !== "boolean") return r.fail(node, "read_only is not true or false");
  r.text(node, "read_only");
  return node.value;
}

/** A bind source as Compose tells it from a volume name: absolute, or starting `.` or `..` (05-services.md). */
const BIND_SOURCE = /^(?:\/|\.\/|\.\.\/|\.$|\.\.$)/;
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MOUNT_KEYS = new Set(["type", "source", "target", "read_only"]);
const MOUNT_TYPES = new Set(["bind", "volume", "tmpfs"]);

/**
 * `[SOURCE:]TARGET[:ro|rw]` or the long form with only type, source, target and read_only. A `~`, a Windows path, a
 * SELinux or other mode, a relative target and every other long-form key are refused rather than read.
 */
function mount(r: Reader, node: unknown): Mount {
  if (isMap(node)) return longMount(r, node);
  const text = r.text(node, "volume");
  const parts = text.split(":");
  if (text.includes("\\") || parts.length > 3) return r.fail(node, `volume ${text} is not [SOURCE:]TARGET[:ro|rw]`);
  const [first = "", target = "", mode = "rw"] = parts.length === 1 ? ["", text] : parts;
  if (!target.startsWith("/")) r.fail(node, `volume target ${target} is not absolute`);
  if (mode !== "ro" && mode !== "rw") r.fail(node, `volume mode ${mode} is refused`);
  const readOnly = mode === "ro";
  if (parts.length === 1) return { type: "volume", source: null, target, readOnly };
  if (isHomeOrInterpolated(first)) r.fail(node, "volume source: a leading ~ or a $ is refused");
  if (BIND_SOURCE.test(first)) return { type: "bind", source: first, target, readOnly };
  if (!VOLUME_NAME.test(first)) r.fail(node, `volume source ${first} is neither a path nor a volume name`);
  return { type: "volume", source: first, target, readOnly };
}

/**
 * A named volume must be declared at the top level, as Compose requires (05-services.md "volumes"). The check is per
 * file, stricter than Compose's merge: each file declares what it mounts, so it stays self-contained (architecture,
 * 2026-10-12).
 */
function declared(r: Reader, mount: Mount, node: unknown, volumes: ReadonlySet<string>): Mount {
  if (mount.type === "volume" && mount.source !== null && !volumes.has(mount.source)) {
    r.fail(node, `volume ${mount.source} is not declared`);
  }
  return mount;
}

function longMount(r: Reader, node: YAMLMap): Mount {
  for (const pair of node.items) {
    if (!MOUNT_KEYS.has(r.text(pair.key, "volume key"))) r.fail(pair.key, `volume key ${r.text(pair.key, "key")}`);
  }
  const field = (key: string) => (node.has(key) ? r.text(node.get(key, true), `volume ${key}`) : null);
  const type = field("type") ?? "";
  if (!MOUNT_TYPES.has(type)) return r.fail(node, `volume type ${type} is refused`);
  const target = field("target");
  if (target === null || !target.startsWith("/")) return r.fail(node, "volume target is not absolute");
  if (type === "tmpfs" && !TMPFS_TARGETS.includes(target)) r.fail(node, `volume tmpfs ${TMPFS_WHY}`);
  const source = node.has("source") ? r.path(node.get("source", true), "volume source") : null;
  if (type === "bind" && source === null) r.fail(node, "bind volume has no source");
  const readOnly = node.get("read_only", true);
  if (readOnly !== undefined && (!isScalar(readOnly) || typeof readOnly.value !== "boolean")) {
    r.fail(readOnly, "read_only is not true or false");
  }
  return {
    type: type as Mount["type"],
    source,
    target,
    readOnly: isScalar(readOnly) && readOnly.value === true,
  };
}

const ATTACHMENT_KEYS = new Set(["aliases", "ipv4_address", "ipv6_address", "priority"]);
// No `name`: it is the real Docker network name, so two keys could share one network, or one key could take another's
// `<project>_<key>`, merging networks the C17 table keeps apart (P1.30n). The project's own `name:` is unaffected.
const NETWORK_KEYS = new Set(["internal", "driver", "ipam"]);
const isEmpty = (node: unknown): boolean => node === null || (isScalar(node) && node.value === null);

/**
 * The only aliases there are: the edge's own two hosts, each a whole interpolation, on the edge network (where the PDS
 * reaches them) and the app network (where web does), and nowhere else (P1.29a Amendment 1, architecture record
 * 2026-10-13-p129a-pds-and-edge-in-compose; architecture 2026-10-15 02:05Z, option C point 3, in book edit
 * 2026-10-14-p134d-split). An alias makes a container answer to that name on the network, so any other one could let a
 * container claim the PDS's or the app's host.
 */
const EDGE_ALIASES = ["${APP_HOST}", "${PDS_HOSTNAME}"];
const ALIAS_NETWORKS = new Set(["edge", "app"]);

function aliases(r: Reader, node: unknown, service: string, network: string): void {
  if (service !== "edge") r.fail(node, `aliases on ${service}: only the edge carries aliases`);
  if (!ALIAS_NETWORKS.has(network)) r.fail(node, `aliases on network ${network}: only edge and app carry them`);
  const values = isSeq(node) ? node.items.map((item) => r.text(item, "alias")) : [];
  const exact = values.length === EDGE_ALIASES.length && EDGE_ALIASES.every((host) => values.includes(host));
  if (!exact) r.fail(node, "the edge's aliases must be exactly ${APP_HOST} and ${PDS_HOSTNAME}");
}

/** Whether a service's `networks:` mapping gives `network` an attachment with aliases. */
const aliased = (node: unknown, network: string): boolean =>
  isMap(node) &&
  node.items.some(
    (pair) => isScalar(pair.key) && pair.key.value === network && isMap(pair.value) && pair.value.has("aliases"),
  );

/** `networks:` on a service, as a list of keys or a map of key to attachment; with neither it is on `default`. */
function serviceNetworks(r: Reader, node: unknown, hasMode: boolean, service: string): string[] {
  if (node === undefined) return hasMode ? [] : ["default"];
  if (hasMode) return r.fail(node, `${service} sets both networks and network_mode`);
  let names: string[];
  if (isSeq(node)) {
    r.noDollar(node, "networks");
    names = node.items.map((n) => r.text(n, "network"));
  } else if (isMap(node)) {
    names = node.items.map((pair) => {
      r.noDollar(pair.key, "networks");
      if (!isEmpty(pair.value) && !isMap(pair.value)) r.fail(pair.value, "network attachment is not a mapping");
      for (const key of isMap(pair.value) ? pair.value.items : []) {
        const field = r.text(key.key, "attachment key");
        if (!ATTACHMENT_KEYS.has(field)) r.fail(key.key, `network attachment key ${field}`);
        if (field === "aliases") aliases(r, key.value, service, r.text(pair.key, "network"));
        else r.noDollar(key.value, "networks");
      }
      return r.text(pair.key, "network");
    });
  } else {
    return r.fail(node, `networks of ${service} is not a list or mapping`);
  }
  if (names.length === 0) r.fail(node, `networks of ${service} is empty`);
  if (new Set(names).size !== names.length) r.fail(node, `networks of ${service} repeats a network`);
  // The other half of "each network carries exactly both" (verify-895 N3): an edge that carries its aliases carries them
  // on each of edge and app it joins. Under dev it carries none, so the PDS and web reach both hosts through Pangolin
  // (ADR 0031, Decision 3); compose.dev.test.ts pins that.
  const joined = names.filter((name) => service === "edge" && ALIAS_NETWORKS.has(name));
  const bare = joined.find((name) => !aliased(node, name));
  if (bare !== undefined && joined.some((name) => aliased(node, name))) {
    r.fail(node, `the edge on network ${bare} must carry its aliases`);
  }
  return names;
}

/** Top-level `networks:`. An external network's settings live outside the file, so it is refused, as is any driver
 * but bridge. */
function networks(r: Reader, node: unknown): Network[] {
  if (node === undefined) return [];
  if (!isMap(node)) return r.fail(node, "networks is not a mapping");
  r.noDollar(node, "networks");
  return node.items.map((pair) => {
    const name = r.text(pair.key, "network name");
    if (isEmpty(pair.value)) return { name, internal: false, subnet: null };
    const spec = pair.value;
    if (!isMap(spec)) return r.fail(spec, `network ${name} is not a mapping`);
    for (const key of spec.items) {
      const field = r.text(key.key, "network key");
      if (!NETWORK_KEYS.has(field)) r.fail(key.key, `network ${name}: ${field} is refused`);
    }
    if (spec.has("driver") && r.text(spec.get("driver", true), "driver") !== "bridge") {
      r.fail(spec.get("driver", true), `network ${name}: driver other than bridge`);
    }
    const subnet = spec.has("ipam") ? ipamSubnet(r, spec.get("ipam", true), name) : null;
    const internal = spec.get("internal", true);
    if (internal === undefined) return { name, internal: false, subnet };
    if (!isScalar(internal) || typeof internal.value !== "boolean") {
      return r.fail(internal, `network ${name}: internal is not true or false`);
    }
    r.text(internal, "internal");
    return { name, internal: internal.value, subnet };
  });
}

const IPV4_CIDR =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(?:[1-2]?\d|3[0-2])$/;

/**
 * `ipam` as exactly `{config: [{subnet: <IPv4 CIDR>}]}` (compose-spec 06-networks.md "ipam"): a fixed subnet, so a
 * service's `ipv4_address` on it is fixed too (compose-spec de28432 spec.md:1893-1897: a static address needs an ipam
 * subnet covering it; ADR 0030, Decision 2). No driver, options, gateway or ranges: the default
 * driver gives the first address to the gateway.
 */
function ipamSubnet(r: Reader, node: unknown, network: string): string {
  const refuse = (at: unknown): never => r.fail(at, `network ${network}: ipam must be exactly {config: [{subnet}]}`);
  if (!isMap(node) || node.items.length !== 1 || !node.has("config")) return refuse(node);
  const config = node.get("config", true);
  if (!isSeq(config) || config.items.length !== 1) return refuse(config);
  const [entry] = config.items;
  if (!isMap(entry) || entry.items.length !== 1 || !entry.has("subnet")) return refuse(entry);
  const subnet = r.text(entry.get("subnet", true), "subnet");
  if (!IPV4_CIDR.test(subnet)) r.fail(entry, `network ${network}: subnet ${subnet} is not an IPv4 CIDR`);
  return subnet;
}

/** Every network the stack has, as Compose creates them: the declared ones, plus `default` when a service is on it
 * and no file declares it. */
export function networksOf(compose: Pick<Compose, "services" | "networks">): Network[] {
  const declared = compose.networks;
  const onDefault = compose.services.some((service) => service.networks.includes("default"));
  const implicit = onDefault && !declared.some((network) => network.name === "default");
  return implicit ? [...declared, { name: "default", internal: false, subnet: null }] : declared;
}

function environment(r: Reader, node: unknown, service: string): [string, EnvValue][] {
  if (node === undefined) return [];
  const entries: [unknown, string, unknown][] = isMap(node)
    ? node.items.map((p) => [p.key, r.text(p.key, "environment key"), p.value])
    : r.list(node, "environment").map((n) => {
        const [key = "", ...rest] = r.text(n, "environment entry").split("=");
        return [n, key, rest.length === 0 ? null : rest.join("=")];
      });
  return entries.map(([n, key, value]) => {
    if (!NAME.test(key)) r.fail(n, `environment key in ${service} is not a name`);
    // An unset value would make Compose take it from the shell of whoever runs `up`.
    if (value === null || (isScalar(value) && value.value === null)) r.fail(n, `${key} has no value`);
    return [key, envValue(r, typeof value === "string" ? value : r.text(value, key), n, key)];
  });
}

/** A value with no `$` but `$$` (a literal dollar), or exactly `${NAME}`; any other interpolation is refused. */
function envValue(r: Reader, raw: string, node: unknown, key: string): EnvValue {
  const ref = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(raw);
  if (ref !== null) return { ref: ref[1] as string };
  if (raw.replaceAll("$$", "").includes("$")) r.fail(node, `${key}: only a whole \${NAME} may interpolate`);
  return { literal: raw.replaceAll("$$", "$") };
}

/** [IP:][HOST:]CONTAINER[/PROTOCOL], IPv6 in brackets; a bare IPv6 address is ambiguous and refused. */
const SHORT_PORT =
  /^(?:(?:(\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:.]+\]):)?(\d+(?:-\d+)?):)?(\d+(?:-\d+)?)(?:\/(?:tcp|udp))?$/;

/** The long-form port keys `port` reads; `protocol`, `mode`, `name` and `app_protocol` are refused by name (P1.30k). */
const PORT_KEYS = new Set(["target", "published", "host_ip"]);

function port(r: Reader, node: unknown): Port {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = r.text(pair.key, "port key");
      if (!PORT_KEYS.has(key)) r.fail(pair.key, `port key ${key}`);
    }
    const field = (key: string) => (node.has(key) ? r.text(node.get(key, true), `port ${key}`) : null);
    const target = field("target");
    if (target === null) return r.fail(node, "port has no target");
    return { hostIp: field("host_ip"), published: field("published"), target };
  }
  const match = SHORT_PORT.exec(r.text(node, "port"));
  if (match === null) return r.fail(node, "port is not [IP:]HOST:CONTAINER");
  const [, ip, published, target] = match;
  return { hostIp: ip?.replace(/^\[|\]$/g, "") ?? null, published: published ?? null, target: target as string };
}

/**
 * Top-level `secrets:`, each exactly `{file: <path>}` (Codex ruling 4, batch 33): a secret from `environment`,
 * `content` or an external store holds a value no check reads, so every other key is refused by name and every other
 * shape as a whole.
 */
function secretFiles(r: Reader, node: unknown): Map<string, string> {
  if (node === undefined) return new Map();
  if (!isMap(node)) return r.fail(node, "secrets is not a mapping");
  return new Map(
    node.items.map((pair): [string, string] => {
      const name = r.text(pair.key, "secret name");
      const notFile = `secret ${name} is not exactly {file}`;
      if (!isMap(pair.value)) return r.fail(pair.value ?? pair.key, notFile);
      for (const key of pair.value.items) {
        const field = r.text(key.key, "secret key");
        if (field !== "file") r.fail(key.key, `secret ${name}: ${field} is refused`);
      }
      const file = pair.value.get("file", true);
      return isString(file) ? [name, r.path(file, "secret file")] : r.fail(file ?? pair.value, notFile);
    }),
  );
}

/**
 * An env file in the strict form: `KEY=VALUE` lines, `#` comment lines and blank lines. A value is unquoted with no
 * `$`, `#`, quote or surrounding space, or single-quoted (Compose takes it literally). Anything else is refused, so
 * Compose's interpolation and inline-comment rules never decide a value.
 */
export function parseEnvFile(text: string, file: string): [string, string][] {
  return text.split("\n").flatMap((line, i): [string, string][] => {
    if (line.trim() === "" || line.startsWith("#")) return [];
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(?:'([^']*)'|([^\s$#'"]*))$/.exec(line);
    if (match === null) throw new ParseError(`${file}:${i + 1}: not KEY=VALUE in the strict form`);
    return [[match[1] as string, match[2] ?? match[3] ?? ""]];
  });
}
