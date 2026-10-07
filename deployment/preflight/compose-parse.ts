// The compose files and env files, read the way the preflight checks them (P1.30). The script parses them itself and
// never runs `docker compose config`, which prints every interpolated secret. It takes a strict subset of YAML
// (architecture record 2026-10-07-p130-preflight-location-and-yaml): one document, no anchor, alias, merge key or
// explicit tag, no duplicate key, no top-level `include`, no `extends`, and no interpolation in a field that bears on
// security. Anything outside the subset is refused, never interpreted, so the preflight cannot read a file one way
// while Compose reads it another (preflight_matches_compose_config checks the rest against Compose in CI).
// yaml 2.9.1 (node_modules/yaml, docs at eemeli.org/yaml): parseAllDocuments, visit, LineCounter.
// Compose: compose-spec 05-services.md ("ports", "env_file", "Env_file format") and 12-interpolation.md.
import { isMap, isScalar, isSeq, LineCounter, type Node, parseAllDocuments, type Scalar, visit } from "yaml";

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
};
export type Compose = { name: string | null; services: Service[]; secretFiles: string[] };

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
    secretFiles: secretFiles(r, root.get("secrets", true)),
  };
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
  };
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
