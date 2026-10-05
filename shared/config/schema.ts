// Field kinds for the typed config loader (P1.02). A field turns one raw environment string into a typed value,
// or reports it invalid; it never sees, keeps or prints any other key.
import { Secret } from "./secret.ts";

export type Kind = "str" | "int" | "bool" | "oneOf" | "url" | "origin" | "list" | "secret" | "secretFile";

/** One configuration key. `parse` returns `undefined` for an invalid value; it never throws and never logs. */
export type Field<T> = {
  readonly kind: Kind;
  readonly parse: (raw: string) => T | undefined;
  readonly default?: T;
};

export type Fields = Record<string, Field<unknown>>;

/** Kinds whose value must come from the secret source rules and never from a default. */
export const SECRET_KINDS: ReadonlySet<Kind> = new Set(["secret", "secretFile"]);
/** A rule across keys, run after every key parsed; `key` is the one reported `invalid` when `holds` is false. */
export type Rule<F extends Fields> = { readonly key: keyof F & string; readonly holds: (config: Config<F>) => boolean };
export type Schema<F extends Fields> = { readonly fields: F; readonly rules: readonly Rule<F>[] };
/** The loaded, frozen configuration a schema describes. */
export type Config<F extends Fields> = { readonly [K in keyof F]: F[K] extends Field<infer T> ? T : never };

const withDefault = <T>(field: Omit<Field<T>, "default">, value: T | undefined): Field<T> =>
  value === undefined ? field : { ...field, default: value };

/** A string. `pattern` judges the whole value (it is wrapped in `^(?:…)$`); stateful or multiline flags are refused. */
export function str(options: { pattern?: RegExp; default?: string } = {}): Field<string> {
  const { pattern } = options;
  if (pattern && /[gym]/.test(pattern.flags)) throw new Error(`str pattern may not use flags g, y or m: ${pattern}`);
  const whole = pattern ? new RegExp(`^(?:${pattern.source})$`, pattern.flags) : undefined;
  return withDefault({ kind: "str", parse: (raw) => (whole && !whole.test(raw) ? undefined : raw) }, options.default);
}

/** A decimal integer in `[min, max]`; no leading zeros, `-0`, exponents, hex or surrounding spaces. */
export function int(options: { min: number; max: number; default?: number }): Field<number> {
  const parse = (raw: string): number | undefined => {
    if (!/^(?:0|-?[1-9][0-9]*)$/.test(raw)) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= options.min && value <= options.max ? value : undefined;
  };
  return withDefault({ kind: "int", parse }, options.default);
}

/** `true` or `false`, exactly. */
export function bool(options: { default?: boolean } = {}): Field<boolean> {
  const parse = (raw: string): boolean | undefined => (raw === "true" ? true : raw === "false" ? false : undefined);
  return withDefault({ kind: "bool", parse }, options.default);
}

/** One of a fixed set of strings. */
export function oneOf<const V extends string>(values: readonly V[], options: { default?: V } = {}): Field<V> {
  const parse = (raw: string): V | undefined => values.find((v) => v === raw);
  return withDefault({ kind: "oneOf", parse }, options.default);
}

type Protocols = readonly ("https:" | "http:")[];

/** A URL parsed by WHATWG rules, refused when its protocol is not listed or it carries credentials. */
function parseUrl(raw: string, protocols: Protocols): URL | undefined {
  if (!URL.canParse(raw)) return undefined;
  const parsed = new URL(raw);
  if (!(protocols as readonly string[]).includes(parsed.protocol)) return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined; // credentials never travel in URLs
  return parsed;
}

/**
 * An absolute URL, returned as its normalised string (a string, so the frozen config stays immutable). A value the
 * parser had to repair (`https:x.y`, backslashes, tabs) is refused: only adding the root `/` is accepted.
 */
export function url(options: { protocols: Protocols; default?: string }): Field<string> {
  const parse = (raw: string): string | undefined => {
    const href = parseUrl(raw, options.protocols)?.href;
    return href === raw || href === `${raw}/` ? href : undefined;
  };
  return withDefault({ kind: "url", parse }, options.default);
}

/** Scheme, host and optional port, written exactly as the origin serialises (no path, not even `/`). */
export function origin(options: { protocols?: Protocols; default?: string } = {}): Field<string> {
  const protocols = options.protocols ?? ["https:"];
  const parse = (raw: string): string | undefined => {
    const parsed = parseUrl(raw, protocols);
    // A trailing dot names a different origin for the same host; refuse it rather than guess.
    return parsed?.origin === raw && !parsed.hostname.endsWith(".") ? raw : undefined;
  };
  return withDefault({ kind: "origin", parse }, options.default);
}

/** Comma-separated values of one kind; an empty or space-padded item is invalid. A list never holds a secret. */
export function list<T>(item: Field<T>, options: { default?: readonly T[] } = {}): Field<readonly T[]> {
  if (SECRET_KINDS.has(item.kind)) throw new Error("a list cannot hold secrets: their source rules would not apply");
  const parse = (raw: string): readonly T[] | undefined => {
    const parts = raw.split(",");
    if (parts.some((part) => part === "" || part !== part.trim())) return undefined;
    const values = parts.map((part) => item.parse(part));
    return values.every((v) => v !== undefined) ? (values as T[]) : undefined;
  };
  return withDefault({ kind: "list", parse }, options.default);
}

/** `never` keeps a default out at compile time; the runtime check keeps it out of untyped callers. */
type SecretOptions = { minBytes: number; default?: never };

function secretField(kind: "secret" | "secretFile", options: SecretOptions): Field<Secret> {
  if ("default" in options) throw new Error(`${kind} has no default`);
  const parse = (raw: string): Secret | undefined =>
    Buffer.byteLength(raw, "utf8") >= options.minBytes ? new Secret(raw) : undefined;
  return { kind, parse };
}

/** A secret read from the environment variable itself; refused in `prod` (use `secretFile`). No default exists. */
export const secret = (options: SecretOptions): Field<Secret> => secretField("secret", options);

/** A secret read from the file named by `<KEY>_FILE` (a Compose secret). No default exists. */
export const secretFile = (options: SecretOptions): Field<Secret> => secretField("secretFile", options);

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** A schema: the fields an entrypoint reads, and any rules across them. Keys are environment names. */
export function defineConfig<F extends Fields>(fields: F, options: { rules?: readonly Rule<F>[] } = {}): Schema<F> {
  for (const [key, field] of Object.entries(fields)) {
    if (!ENV_NAME.test(key)) throw new Error(`config key is not an environment name: ${key}`);
    if (SECRET_KINDS.has(field.kind) && "default" in field) throw new Error(`${key}: a secret has no default`);
  }
  return { fields, rules: options.rules ?? [] };
}

/**
 * Processes that load this config. `pds-admin` and `chat-admin` are absent: they import nothing outside their own
 * folder (plan §5.2). A process joins this list in the step that creates it.
 */
export const SERVICES = [
  "http",
  "admin",
  "api",
  "indexer",
  "media",
  "review",
  "jobs",
  "audit-verify",
  "chat-auth",
] as const;

const PLACEHOLDER_COMMIT = "0".repeat(40);

/** Keys every entrypoint has (P1.02). `UNSET_COMMIT` is stamped at image build; the all-zero value is dev-only. */
const COMMON_FIELDS = {
  UNSET_ENV: oneOf(["dev", "test", "prod"]),
  UNSET_SERVICE: oneOf(SERVICES),
  UNSET_COMMIT: str({ pattern: /^[0-9a-f]{40}$/ }),
  LISTEN_PORT: int({ min: 1024, max: 65535 }),
};

/** An entrypoint's schema: the common keys, then its own (which may not redefine a common key). */
export function defineEntrypointConfig<F extends Fields>(
  fields: F & { [K in keyof typeof COMMON_FIELDS]?: never },
  options: { rules?: readonly Rule<typeof COMMON_FIELDS & F>[] } = {},
): Schema<typeof COMMON_FIELDS & F> {
  const commitRule: Rule<typeof COMMON_FIELDS & F> = {
    key: "UNSET_COMMIT",
    holds: (config) => config.UNSET_COMMIT !== PLACEHOLDER_COMMIT || config.UNSET_ENV === "dev",
  };
  const clash = Object.keys(fields).filter((key) => key in COMMON_FIELDS);
  if (clash.length > 0) throw new Error(`entrypoint config redefines common keys: ${clash.join(", ")}`);
  const all = { ...COMMON_FIELDS, ...fields } as typeof COMMON_FIELDS & F;
  return defineConfig(all, { rules: [commitRule, ...(options.rules ?? [])] });
}
