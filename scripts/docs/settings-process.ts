// Process settings for the settings pages (P1.21a): each process's shared-config schema (imported, so Field.kind,
// Field.allowed and Field.default are the loader's own), pds-admin's readConfig (parsed as text, since pds-admin imports
// nothing; a read of env in any other shape is a problem), and the compose files' environment and resource keys
// (yaml 2.9.1; parse uses the YAML 1.2 core schema by default, https://eemeli.org/yaml/#options, read 2026-11-19).
// A secret shows its name and that it is required; no secret value or secret file is ever read.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

export const STACKS = [
  { name: "local", file: "deployment/compose.local.yaml" },
  { name: "staging", file: "deployment/compose.dev.yaml" },
] as const;
const SECRET_KINDS = new Set(["secret", "secretFile"]);
const SECRET_NAME = /SECRET|PASSWORD|TOKEN|PRIVATE|CREDENTIAL|(^|_)KEY(S)?$/;
const PDS_ADMIN = "interfaces/pds-admin/config.ts";

/** Processes whose settings come from a shared-config schema: where the schema is, and its compose service. */
export const SCHEMAS = [
  { process: "web", file: "interfaces/web/src/lib/server/config.ts", name: "schema", service: "web" },
  { process: "indexer", file: "interfaces/indexer/config.ts", name: "schema", service: "indexer" },
  { process: "migrate", file: "infrastructure/postgres/migrate-cli.ts", name: "migrateConfig", service: "migrate" },
  { process: "rewrap", file: "infrastructure/postgres/rewrap-cli.ts", name: "rewrapConfig", service: null },
] as const;

export type Setting = {
  readonly key: string;
  readonly kind: string;
  readonly allowed: string;
  readonly fallback: string;
  readonly secret: boolean;
  readonly source: string;
  readonly stacks: readonly string[];
};
export type ProcessSettings = { readonly process: string; readonly settings: readonly Setting[] };
type Env = Readonly<Record<string, string>>;
type Service = { readonly env: Env; readonly limits: Env };
export type Stack = { readonly name: string; readonly services: ReadonlyMap<string, Service> };
export type Row = readonly string[];
export const cell = (value: string): string => value.replaceAll("|", "\\|").replaceAll("\n", " ").replaceAll("`", "'");
export const code = (value: string): string => (value === "" ? "(empty)" : `\`${cell(value)}\``);
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What a stack sets for a key, never a secret's value: an interpolation shows only its variable's name. */
export function stackCell(key: string, value: string | undefined, secret: boolean): string {
  if (value === undefined) return "not set";
  const variable = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
  if (variable) return `from env file: \`${variable[1]}\``;
  if (secret) return "secret file";
  if (key.endsWith("_FILE")) return `file ${code(value)}`;
  if (SECRET_NAME.test(key)) return "set (secret, not shown)";
  return code(value);
}

function formatValue(value: unknown): string {
  if (value === undefined) return "required";
  if (Array.isArray(value)) return value.length === 0 ? "(empty list)" : code(value.join(","));
  return code(String(value));
}

export async function importNamed(root: string, file: string, name: string): Promise<unknown> {
  const mod: Record<string, unknown> = await import(pathToFileURL(join(root, file)).href);
  if (!Object.hasOwn(mod, name)) throw new Error(`${file} does not export ${name}`);
  return mod[name];
}

/** The first file that defines `key` as an object property: the schema's own folder, then the shared field groups. */
function definedIn(root: string, own: string, key: string, candidates: readonly string[]): string | undefined {
  const line = new RegExp(`(^\\s*|\\{ )${key}:\\s`, "m");
  const near = tsFiles(root, dirname(own));
  return [own, ...near, ...candidates].find((file) => line.test(readFileSync(join(root, file), "utf8")));
}

/** Source .ts files under `dir`, not tests and not build output, sorted. */
const SKIPPED_DIRS = new Set(["node_modules", "dist"]);

function tsFiles(root: string, dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((rel) => /(?<!\.test|\.d)\.ts$/.test(rel) && !rel.split("/").some((part) => SKIPPED_DIRS.has(part)))
    .map((rel) => `${dir}/${rel}`)
    .sort();
}

function fieldFiles(root: string): string[] {
  return ["shared/config", "shared/http", "infrastructure"].flatMap((dir) => tsFiles(root, dir));
}

function stackValues(stacks: readonly Stack[], service: string | null, key: string, secret: boolean): string[] {
  return stacks.map((stack) => {
    const env = service === null ? undefined : stack.services.get(service)?.env;
    if (env === undefined) return "not in this stack";
    return stackCell(key, env[key] ?? env[`${key}_FILE`], secret);
  });
}

export async function schemaSettings(
  root: string,
  stacks: readonly Stack[],
  problems: string[],
): Promise<ProcessSettings[]> {
  const candidates = fieldFiles(root);
  const out: ProcessSettings[] = [];
  for (const entry of SCHEMAS) {
    const schema = await importNamed(root, entry.file, entry.name);
    if (!isObject(schema) || !isObject(schema.fields)) {
      problems.push(`${entry.file}: ${entry.name} is not a schema`);
      continue;
    }
    const settings = Object.entries(schema.fields).map(([key, raw]): Setting => {
      const field = raw as { kind: string; allowed?: string; default?: unknown };
      const secret = SECRET_KINDS.has(field.kind);
      const source = definedIn(root, entry.file, key, candidates);
      if (source === undefined) problems.push(`${entry.process}: cannot find where ${key} is defined`);
      return {
        key,
        kind: field.kind,
        allowed: field.allowed ?? (field.kind === "str" ? "text (pattern in source)" : "see source"),
        fallback: secret ? "required" : formatValue(field.default),
        secret,
        source: source ?? "not found",
        stacks: stackValues(stacks, entry.service, key, secret),
      };
    });
    out.push({ process: entry.process, settings });
  }
  return out;
}

const PDS_ADMIN_READS = [
  { re: /required\(env, "([A-Z0-9_]+)"\)/g, read: (m: RegExpMatchArray) => [m[1], "str", "text", "required"] },
  {
    re: /integer\(env, "([A-Z0-9_]+)", ([0-9_* ]+), ([0-9_* ]+)\)/g,
    read: (m: RegExpMatchArray) => [m[1], "int", `1 to ${evalProduct(m[3])}`, code(String(evalProduct(m[2])))],
  },
  { re: /env\.([A-Z0-9_]+) \?\? "([^"]*)"/g, read: (m: RegExpMatchArray) => [m[1], "str", "text", code(m[2] ?? "")] },
  { re: /secret\(secrets, "([a-z0-9_]+)"\)/g, read: (m: RegExpMatchArray) => [m[1], "secretFile", "file", "required"] },
] as const;

function evalProduct(text: string | undefined): number {
  return (text ?? "").split("*").reduce((acc, part) => acc * Number(part.trim().replaceAll("_", "")), 1);
}

/** pds-admin's settings, from its readConfig source. Any other read of `env` or `secret(` is a problem, not a guess. */
export function readPdsAdminSettings(text: string): { settings: string[][]; problems: string[] } {
  const start = text.indexOf("export function readConfig(");
  if (start < 0) return { settings: [], problems: [`${PDS_ADMIN}: readConfig not found`] };
  let body = text.slice(start + "export function readConfig(".length);
  const found: { at: number; row: string[] }[] = [];
  for (const { re, read } of PDS_ADMIN_READS) {
    for (const match of body.matchAll(re)) found.push({ at: match.index, row: read(match).map(String) });
  }
  const settings = found.sort((a, b) => a.at - b.at).map((f) => f.row);
  for (const { re } of PDS_ADMIN_READS) body = body.replace(re, "");
  const leftover = /\benv\s*[.[,)]|\(env\b|\bsecret\(/.exec(body);
  const problems = leftover
    ? [`${PDS_ADMIN}: unrecognised read near "${body.slice(leftover.index, leftover.index + 40)}"`]
    : [];
  return { settings, problems };
}

export function pdsAdminProcess(root: string, stacks: readonly Stack[], problems: string[]): ProcessSettings {
  const parsed = readPdsAdminSettings(readFileSync(join(root, PDS_ADMIN), "utf8"));
  problems.push(...parsed.problems);
  const settings = parsed.settings.map(([key = "", kind = "", allowed = "", fallback = ""]): Setting => {
    const secret = kind === "secretFile";
    return {
      key,
      kind,
      allowed,
      fallback,
      secret,
      source: PDS_ADMIN,
      stacks: secret
        ? stacks.map((stack) => (stack.services.has("pds-admin") ? "secret file" : "not in this stack"))
        : stackValues(stacks, "pds-admin", key, false),
    };
  });
  return { process: "pds-admin", settings };
}

export function loadStacks(root: string, problems: string[]): Stack[] {
  return STACKS.map(({ name, file }) => {
    const doc: unknown = parseYaml(readFileSync(join(root, file), "utf8"));
    const services = new Map<string, Service>();
    const raw = isObject(doc) && isObject(doc.services) ? doc.services : {};
    for (const [service, value] of Object.entries(raw)) {
      if (!isObject(value)) continue;
      const env = value.environment ?? {};
      if (!isObject(env)) problems.push(`${file}: ${service} environment is not a map`);
      const asEnv = (o: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
      const limits = { mem_limit: value.mem_limit, cpus: value.cpus, pids_limit: value.pids_limit };
      services.set(service, {
        env: isObject(env) ? asEnv(env) : {},
        limits: asEnv(Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined))),
      });
    }
    return { name, services };
  });
}

export function otherServices(stacks: readonly Stack[], known: ReadonlySet<string>) {
  const names = [...new Set(stacks.flatMap((stack) => [...stack.services.keys()]))].filter((s) => !known.has(s)).sort();
  return names.map((service) => {
    const keys = [...new Set(stacks.flatMap((stack) => Object.keys(stack.services.get(service)?.env ?? {})))].sort();
    return { service, rows: keys.map((key) => [code(key), ...stackValues(stacks, service, key, false)]) };
  });
}

export function containerRows(stacks: readonly Stack[]): Row[] {
  const names = [...new Set(stacks.flatMap((stack) => [...stack.services.keys()]))].sort();
  return names.map((service) => [
    code(service),
    ...stacks.map((stack) => {
      const limits = stack.services.get(service)?.limits;
      if (limits === undefined) return "not in this stack";
      return `${limits.mem_limit ?? "?"} memory, ${limits.cpus ?? "?"} CPU, ${limits.pids_limit ?? "?"} processes`;
    }),
  ]);
}
