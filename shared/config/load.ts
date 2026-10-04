// The typed config loader (P1.02): each process reads its configuration once at boot, refuses to start on any
// missing or invalid key, and never prints a value; problems name keys and reasons only.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { Config, Field, Fields, Kind, Schema } from "./schema.ts";

export type Reason = "missing" | "invalid" | "unreadable" | "forbidden_in_env";
export type Problem = { readonly key: string; readonly reason: Reason };
type Env = Readonly<Record<string, string | undefined>>;

/** Boot refused: every problem at once, so one start shows every missing key. Carries no value. */
export class ConfigError extends Error {
  readonly code = "config.invalid";
  readonly problems: readonly Problem[];

  constructor(problems: readonly Problem[]) {
    super(`config.invalid: ${problems.map((p) => `${p.key} ${p.reason}`).join(", ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const MAX_SECRET_FILE_BYTES = 64 * 1024;
const EX_CONFIG = 78;

/** Reads a secret file (symlinks followed), or returns `undefined` when it is not a readable, private regular file. */
function readSecretFile(path: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_SECRET_FILE_BYTES || (stat.mode & 0o002) !== 0) return undefined;
    const buffer = Buffer.alloc(MAX_SECRET_FILE_BYTES + 1);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length > MAX_SECRET_FILE_BYTES) return undefined; // grew after fstat
    return buffer
      .subarray(0, length)
      .toString("utf8")
      .replace(/\r?\n$/, "");
  } catch {
    return undefined; // ENOENT, EACCES, EISDIR: reported as `unreadable`, never as a value
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

type Read = { raw: string | undefined } | { problem: Reason };

/** Where a key's raw value comes from, and the checks on its source (step 1a–1c of the algorithm). */
function readRaw(key: string, kind: Kind, env: Env): Read {
  const prod = env.UNSET_ENV === "prod";
  if (kind === "secretFile") {
    if (env[key] !== undefined && prod) return { problem: "forbidden_in_env" };
    const path = env[`${key}_FILE`];
    if (path === undefined || path.trim() === "") return { raw: undefined };
    const contents = readSecretFile(path);
    return contents === undefined ? { problem: "unreadable" } : { raw: contents };
  }
  if (kind === "secret" && prod && env[key] !== undefined) return { problem: "forbidden_in_env" };
  return { raw: env[key] };
}

function loadField(key: string, field: Field<unknown>, env: Env): { value: unknown } | { problem: Reason } {
  const read = readRaw(key, field.kind, env);
  if ("problem" in read) return read;
  if (read.raw === undefined || read.raw.trim() === "") {
    // Secret fields have no default by construction (schema.ts), so this never defaults a secret.
    return field.default === undefined ? { problem: "missing" } : { value: field.default };
  }
  const value = field.parse(read.raw);
  return value === undefined ? { problem: "invalid" } : { value };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** `UNSET_*` keys the schema does not read: named in a warning, because old and new code overlap in a deploy. */
function unknownKeys<F extends Fields>(schema: Schema<F>, env: Env): string[] {
  const known = new Set(Object.keys(schema.fields).flatMap((key) => [key, `${key}_FILE`]));
  return Object.keys(env)
    .filter((key) => key.startsWith("UNSET_") && !known.has(key))
    .sort();
}

const writeLine = (record: object): void => {
  process.stderr.write(`${JSON.stringify(record)}\n`);
};

export type LoadOptions = { onUnknownKeys?: (keys: string[]) => void };

/** Reads, parses and freezes the configuration a schema describes, or throws `ConfigError`. */
export function loadConfig<F extends Fields>(
  schema: Schema<F>,
  env: Env = process.env,
  options: LoadOptions = {},
): Config<F> {
  const problems: Problem[] = [];
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(schema.fields).sort()) {
    const result = loadField(key, schema.fields[key] as Field<unknown>, env);
    if ("problem" in result) problems.push({ key, reason: result.problem });
    else values[key] = result.value;
  }
  if (problems.length > 0) throw new ConfigError(problems);
  const config = values as Config<F>;
  const broken = schema.rules.filter((rule) => !rule.holds(config)).map((rule) => rule.key);
  if (broken.length > 0) throw new ConfigError([...new Set(broken)].map((key) => ({ key, reason: "invalid" })));
  const unknown = unknownKeys(schema, env);
  if (unknown.length > 0) {
    (options.onUnknownKeys ?? ((keys) => writeLine({ event: "config.unknown_keys", keys })))(unknown);
  }
  return deepFreeze(config);
}

/** Each key, its kind and whether it is set, for the health board. Never a value. */
export function describeConfig<F extends Fields>(
  schema: Schema<F>,
  env: Env = process.env,
): { key: string; kind: Kind; set: boolean }[] {
  return Object.entries(schema.fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, field]) => {
      const source = env[field.kind === "secretFile" ? `${key}_FILE` : key];
      return { key, kind: field.kind, set: source !== undefined && source.trim() !== "" };
    });
}

/**
 * Loads the configuration at boot. On `ConfigError` it writes one JSON line per problem to stderr and exits 78
 * (EX_CONFIG); any other failure exits 1. No value reaches either output.
 */
export function bootOrExit<F extends Fields>(schema: Schema<F>): Config<F> {
  try {
    return loadConfig(schema);
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      writeLine({ event: "config.load_failed" });
      process.exit(1);
    }
    for (const { key, reason } of error.problems) writeLine({ event: "config.invalid", key, reason });
    process.exit(EX_CONFIG);
  }
}
