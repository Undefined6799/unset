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
};
/** A top-level network: only `internal`, a `bridge` driver and `name` are read; anything else is refused. */
export type Network = { name: string; internal: boolean };
export type Compose = { name: string | null; services: Service[]; networks: Network[]; secretFiles: string[] };

export class ParseError extends Error {}

const OPTIONS = { version: "1.2", schema: "core", uniqueKeys: true, merge: false, strict: true } as const;
/** Service fields where a `$` would let the environment change what runs (the ruling's list). */
const NO_INTERPOLATION = [
  "image",
  "privileged",
  "cap_add",
  "security_opt",
  "user",
  "network_mode",
  "pid",
  "ipc",
  "ports",
  "volumes",
  "devices",
  "read_only",
  "env_file",
];
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Line-aware helpers over one parsed file: every refusal names the file and line. */
type Reader = {
  fail(node: unknown, why: string): never;
  /** A scalar's text as Compose reads it; a number or boolean must be written in its one canonical form. */
  text(node: unknown, what: string): string;
  list(node: unknown, what: string): unknown[];
  noDollar(node: unknown, what: string): void;
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
  return { fail, text, list, noDollar };
}

export function parseCompose(text: string, file: string): Compose {
  const lines = new LineCounter();
  const r = reader(file, lines);
  const doc = strictDocument(text, file, lines, r);
  const root = doc.contents;
  if (!isMap(root)) return r.fail(root, "the file is not a mapping");
  if (root.has("include")) r.fail(root.get("include", true), "include");
  const name = root.get("name", true);
  if (name !== undefined) r.noDollar(name, "name");
  const servicesNode = root.get("services", true);
  if (!isMap(servicesNode)) return r.fail(servicesNode, "services is not a mapping");
  return {
    name: name === undefined ? null : r.text(name, "name"),
    services: servicesNode.items.map((pair) => service(r, r.text(pair.key, "service name"), pair.value)),
    networks: networks(r, root.get("networks", true)),
    secretFiles: secretFiles(r, root.get("secrets", true)),
  };
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

function service(r: Reader, name: string, spec: unknown): Service {
  if (!isMap(spec)) return r.fail(spec, `service ${name} is not a mapping`);
  if (spec.has("extends")) r.fail(spec.get("extends", true), "extends");
  for (const field of NO_INTERPOLATION) if (spec.has(field)) r.noDollar(spec.get(field, true), field);
  const image = spec.get("image", true);
  return {
    name,
    image: image === undefined ? null : r.text(image, "image"),
    envFiles: r.list(spec.get("env_file", true), "env_file").map((n) => r.text(n, "env_file")),
    environment: environment(r, spec.get("environment", true), name),
    ports: r.list(spec.get("ports", true), "ports").map((n) => port(r, n)),
    networks: serviceNetworks(r, spec.get("networks", true), spec.has("network_mode"), name),
    networkMode: spec.has("network_mode") ? r.text(spec.get("network_mode", true), "network_mode") : null,
  };
}

const ATTACHMENT_KEYS = new Set(["aliases", "ipv4_address", "ipv6_address", "priority"]);
const NETWORK_KEYS = new Set(["internal", "driver", "name"]);
const isEmpty = (node: unknown): boolean => node === null || (isScalar(node) && node.value === null);

/** `networks:` on a service, as a list of keys or a map of key to attachment; with neither it is on `default`. */
function serviceNetworks(r: Reader, node: unknown, hasMode: boolean, service: string): string[] {
  if (node === undefined) return hasMode ? [] : ["default"];
  if (hasMode) return r.fail(node, `${service} sets both networks and network_mode`);
  r.noDollar(node, "networks");
  let names: string[];
  if (isSeq(node)) {
    names = node.items.map((n) => r.text(n, "network"));
  } else if (isMap(node)) {
    names = node.items.map((pair) => {
      if (!isEmpty(pair.value) && !isMap(pair.value)) r.fail(pair.value, "network attachment is not a mapping");
      for (const key of isMap(pair.value) ? pair.value.items : []) {
        const field = r.text(key.key, "attachment key");
        if (!ATTACHMENT_KEYS.has(field)) r.fail(key.key, `network attachment key ${field}`);
      }
      return r.text(pair.key, "network");
    });
  } else {
    return r.fail(node, `networks of ${service} is not a list or mapping`);
  }
  if (names.length === 0) r.fail(node, `networks of ${service} is empty`);
  if (new Set(names).size !== names.length) r.fail(node, `networks of ${service} repeats a network`);
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
    if (isEmpty(pair.value)) return { name, internal: false };
    const spec = pair.value;
    if (!isMap(spec)) return r.fail(spec, `network ${name} is not a mapping`);
    for (const key of spec.items) {
      const field = r.text(key.key, "network key");
      if (!NETWORK_KEYS.has(field)) r.fail(key.key, `network ${name}: ${field} is refused`);
    }
    if (spec.has("driver") && r.text(spec.get("driver", true), "driver") !== "bridge") {
      r.fail(spec.get("driver", true), `network ${name}: driver other than bridge`);
    }
    if (spec.has("name")) r.text(spec.get("name", true), "network name");
    const internal = spec.get("internal", true);
    if (internal === undefined) return { name, internal: false };
    if (!isScalar(internal) || typeof internal.value !== "boolean") {
      return r.fail(internal, `network ${name}: internal is not true or false`);
    }
    r.text(internal, "internal");
    return { name, internal: internal.value };
  });
}

/** Every network the stack has, as Compose creates them: the declared ones, plus `default` when a service is on it
 * and no file declares it. */
export function networksOf(compose: Pick<Compose, "services" | "networks">): Network[] {
  const declared = compose.networks;
  const onDefault = compose.services.some((service) => service.networks.includes("default"));
  const implicit = onDefault && !declared.some((network) => network.name === "default");
  return implicit ? [...declared, { name: "default", internal: false }] : declared;
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

function port(r: Reader, node: unknown): Port {
  if (isMap(node)) {
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

function secretFiles(r: Reader, node: unknown): string[] {
  if (node === undefined) return [];
  if (!isMap(node)) return r.fail(node, "secrets is not a mapping");
  return node.items.flatMap((pair) => {
    const file = isMap(pair.value) ? pair.value.get("file", true) : undefined;
    return file === undefined ? [] : [r.text(file, "secret file")];
  });
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
