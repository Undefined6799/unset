// The one reader of the edge's Caddyfile for checks (P1.28h; architecture record
// 2026-10-07-p130s-networks-and-caddyfile-reader, point 2, and its 13:40Z amendment): edge.test.ts and, from P1.30u,
// the deploy preflight's C18 read the config through it, so CI and the deploy gate cannot disagree about which routes
// carry the zones.
//
// It is a security reader: it models the part of Caddy v2.11.7's syntax our files use, exactly, and fails on the rest
// rather than reading it differently from Caddy. Read against caddyconfig/caddyfile/lexer.go (next) and parse.go at
// v2.11.7:
// - Tokens: whitespace-separated words, "double" and `backtick` quoted words, `#` comments at the start of a word,
//   newlines ending a directive, `{` and `}` as block tokens. Refused: heredocs, a quote spanning lines or glued to
//   the next word, a backslash inside double quotes, at the start of a word or before whitespace (Caddy's escapes and
//   line continuations), and any character outside printable ASCII, tab and newline.
// - `{$NAME}`: only the names in ENV_NAMES, each value shape-checked so it cannot carry syntax, put into the one token
//   after lexing. Caddy substitutes before lexing (parse.go replaceEnvVars); with no syntax character allowed in a
//   value, the two read the same. `{$NAME:default}` fails.
// - Other placeholders: only the runtime ones our files use, each under the directives that use it (PLACEHOLDERS).
// - `import` expands only a snippet `(name) { … }` defined earlier in the same text, with `{args[N]}` replaced
//   (importer.go). File and glob imports, named routes (`&(name)`, `invoke`), quoted directive names and a quoted
//   first token at the top level fail.
// - Directives come from an allowlist per block (DIRECTIVES): what our files use today, nothing more. Adding one is a
//   trusted change in the same PR as the Caddyfile line that needs it.
// - `readEdgeConfig` (P1.28e) resolves the shipped Caddyfile's two glob imports, and only those, before reading;
//   `edgeSiteProblems` holds the site rules edge.test.ts and C18 share, so neither keeps a copy.
// - The "local" mode (P1.34a, P1.34o) reads the local stack's two files in local/ as its mounts place them; only C18
//   under --env local passes it. APP_HOST, APP_UPSTREAM and the dev leaf's secret paths are accepted only from local/.
// - The "dev" mode (P1.36b; ADR 0031, ADR 0032) reads the dev stack's two sites, dev/app.caddy and dev/pds.caddy, and
//   its `(tls)` from dev/tls.caddy in place of snippets/tls.caddy, as its three file mounts place them (ADR 0032
//   Decision 3): no directory and no shipped site. https with one self-signed leaf from files on the edge's newt_edge
//   address, with APP_HOST and APP_UPSTREAM accepted there too, each only as its one ruled value. The dev leaf's
//   secret paths are accepted only from dev/.

/** One directive line with its arguments, its block if it opens one, and the snippet it was imported from. */
export type Directive = {
  name: string;
  args: string[];
  /** For each argument, the `{$NAME}` placeholder it was written as, or null for a literal (P1.28l). */
  placeholders: (EnvName | null)[];
  block: Directive[] | null;
  /** The snippet whose import produced this directive at this level, or null when written in place. */
  via: string | null;
  line: number;
};
/** A site block; `placeholders[i]` is the `{$NAME}` that `addresses[i]` was written as, or null for a literal. */
export type Site = { addresses: string[]; placeholders: (EnvName | null)[]; directives: Directive[] };
export type Caddyfile = {
  global: Directive[] | null;
  sites: Site[];
  /** A snippet's body read as a block, with `args` in place of `{args[N]}`. */
  snippet(name: string, args?: readonly string[]): Directive[];
};

export class CaddyfileError extends Error {}

/** The `{$NAME}` placeholders the edge's files may use, each with the shape its value must have. */
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const UPSTREAM = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?:\d{1,5}$/;
export const ENV_NAMES = {
  PDS_HOST: HOST,
  PDS_UPSTREAM: UPSTREAM,
  ACME_EMAIL: /^[A-Za-z0-9._%+-]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/,
  // P1.34a: the local app host and its upstream, accepted only in files read from local/ (LOCAL_ONLY).
  APP_HOST: HOST,
  APP_UPSTREAM: UPSTREAM,
} as const;
export type EnvName = keyof typeof ENV_NAMES;

/** Each runtime placeholder our files use, and the directives (or matchers) that may take it as an argument. */
const PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  "{http.request.orig_uri}": ["map", "vars_regexp"],
  "{route_class}": ["map", "log_append"],
  "{client_ip}": ["key"],
  // The request's own Host, the one value (upstream) sets X-Forwarded-Host to (P1.36j, forwardsOwnHost).
  "{host}": ["header_up"],
};

const MATCHERS = ["path", "method", "not", "path_regexp", "header_regexp", "vars_regexp"];
/**
 * The directives allowed in each block: `global`, `site`, `route` and `snippet` (a snippet read on its own), then the
 * block of a named directive. "data" blocks hold names our config chooses (header fields, log fields, map entries).
 */
const DIRECTIVES: Readonly<Record<string, readonly string[] | "data">> = {
  global: ["admin", "persist_config", "log", "servers"],
  site: ["bind", "respond", "tls", "log", "map", "log_append", "header", "route"],
  route: ["@", "rate_limit", "respond", "header", "reverse_proxy"],
  snippet: ["@", "log", "rate_limit", "map", "log_append", "header", "tls", "reverse_proxy", "respond"],
  "@": MATCHERS,
  log: ["output", "level", "exclude", "format"],
  format: ["wrap", "fields"],
  fields: "data",
  servers: ["trusted_proxies", "trusted_proxies_strict", "client_ip_headers", "timeouts"],
  timeouts: ["read_body", "write", "idle"],
  tls: ["issuer"],
  issuer: ["dir", "email"],
  map: "data",
  header: "data",
  respond: ["close"],
  reverse_proxy: ["header_up", "transport"],
  transport: ["dial_timeout", "response_header_timeout"],
  rate_limit: ["zone", "disable_metrics"],
  zone: ["match", "key", "ipv6_prefix", "events", "window"],
  match: MATCHERS,
};

/** A word; `env` names the `{$NAME}` placeholder it was written as, which is always the whole word (P1.28l). */
type Token = { text: string; quoted: boolean; line: number; env: EnvName | null };
type Line = { tokens: Token[]; via: string | null };
type Env = Readonly<Partial<Record<EnvName, string>>>;

/**
 * `run`'s result; a reader error it throws comes back with every value `env` was given replaced by its placeholder,
 * the site address (PDS_HOST) included (P1.30h, record 2026-10-12-p130h-p130w-c18-follow-ups, ruling B2a; it widens
 * amendment 8, point 5). It walks ENV_NAMES, so no second list of names can fall behind. Longer values go first, so a
 * value inside another (a host inside an upstream) cannot leave part of the longer one behind.
 */
function unechoed<T>(env: Env, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof CaddyfileError)) throw error;
    const given = (Object.keys(ENV_NAMES) as EnvName[])
      .flatMap((name) => {
        const value = env[name];
        return value === undefined || value === "" ? [] : [{ name, value }];
      })
      .sort((a, b) => b.value.length - a.value.length);
    const message = given.reduce((text, { name, value }) => text.replaceAll(value, `{$${name}}`), error.message);
    throw new CaddyfileError(message);
  }
}

/** At most this many snippet expansions in one read: a snippet that imports itself fails instead of looping. */
const MAX_IMPORTS = 1000;

/**
 * The Caddyfile `text` with `env` put in. A reader error never carries a value from `env`, from the read or from a later
 * `snippet()` (P1.28f; amendment 8, point 5; P1.30h).
 */
export function readCaddyfile(text: string, env: Env): Caddyfile {
  const config = unechoed(env, () => parse(text, env));
  return { ...config, snippet: (name, args) => unechoed(env, () => config.snippet(name, args)) };
}

function parse(text: string, env: Env): Caddyfile {
  const lines = lex(text).map((line) => ({ ...line, tokens: line.tokens.map((token) => withEnv(token, env)) }));
  const snippets = new Map<string, Line[]>();
  const expander = { snippets, imports: 0 };
  const sites: Site[] = [];
  let global: Directive[] | null = null;
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] as Line;
    const [first, ...rest] = line.tokens as [Token, ...Token[]];
    // Quoted, a first token like "(s)" reads as a snippet or as a site address; we do not decide which Caddy takes.
    if (first.quoted) fail(first.line, `quoted top-level token "${first.text}" is not supported`);
    if (isImport(line)) {
      lines.splice(at, 1, ...expand(line, expander));
      continue;
    }
    if (at === 0 && line.tokens.length === 1 && isOpen(first)) {
      [global, at] = readBlock(lines, at + 1, expander, "global");
      continue;
    }
    if (!first.quoted && first.text.startsWith("&(")) fail(first.line, "named routes are not supported");
    const name = /^\((.+)\)$/.exec(first.text)?.[1];
    if (name !== undefined && !first.quoted && rest.length === 1 && isOpen(rest[0] as Token)) {
      if (snippets.has(name)) fail(first.line, `snippet ${name} is defined twice`);
      const end = blockEnd(lines, at + 1);
      snippets.set(name, lines.slice(at + 1, end));
      at = end + 1;
      continue;
    }
    const last = line.tokens.at(-1) as Token;
    if (line.tokens.length < 2 || !isOpen(last)) fail(first.line, "a top-level line must open a site block");
    const tokens = line.tokens.slice(0, -1);
    const addresses = tokens.map((token) => address(token));
    let directives: Directive[];
    [directives, at] = readBlock(lines, at + 1, expander, "site");
    sites.push({ addresses, placeholders: tokens.map((token) => token.env), directives });
  }
  const snippet = (name: string, args: readonly string[] = []): Directive[] => {
    const body = snippets.get(name);
    if (body === undefined) throw new CaddyfileError(`no snippet ${name}`);
    const values = args.map((text) => ({ text, quoted: false, line: 0, env: null }));
    const copy = body.map((line) => ({ via: line.via, tokens: line.tokens.map((t) => withArgs(t, values)) }));
    copy.push({ via: null, tokens: [{ text: "}", quoted: false, line: 0, env: null }] });
    return readBlock(copy, 0, expander, "snippet")[0];
  };
  return { global, sites, snippet };
}

function fail(line: number, why: string): never {
  throw new CaddyfileError(`line ${line}: ${why}`);
}

/** The host placeholders a site address may be, each alone on its site (APP_HOST from P1.34a). */
const HOSTS: readonly EnvName[] = ["PDS_HOST", "APP_HOST"];
/**
 * A placeholder is a whole word (P1.28l), or a host placeholder after `http://`, the one scheme a dev site address
 * carries (P1.36b): Caddy serves an `http://` site on port 80 with no automatic HTTPS (caddyserver/website 1957519
 * src/docs/markdown/automatic-https.md:84-89).
 */
const WHOLE_PLACEHOLDER = /^(http:\/\/)?\{\$([A-Z_]+)\}$/;

/** `{$NAME}` replaced inside one token; an unlisted name, a default, a missing or a mis-shaped value fails. */
function withEnv(token: Token, env: Env): Token {
  const text = token.text.replaceAll(/\{\$([^}]*)\}/g, (_, name: string) => {
    if (!Object.hasOwn(ENV_NAMES, name)) fail(token.line, `unsupported environment placeholder {$${name}}`);
    const value = env[name as EnvName];
    if (value === undefined) fail(token.line, `environment placeholder {$${name}} has no value`);
    if (!ENV_NAMES[name as EnvName].test(value))
      fail(token.line, `environment value for {$${name}} has the wrong shape`);
    return value;
  });
  if (text.includes("{$")) fail(token.line, `unsupported placeholder in ${token.text}`);
  if (text === token.text) return token;
  // A placeholder is a whole word, so where it sits is a fact the edge rules can check (P1.28l).
  const [, scheme, name] = WHOLE_PLACEHOLDER.exec(token.text) ?? [];
  if (name === undefined || (scheme !== undefined && !HOSTS.includes(name as EnvName))) {
    fail(token.line, "an environment placeholder must be a whole word");
  }
  return { ...token, text, env: name as EnvName };
}

/** Lines of tokens; blank and comment-only lines dropped. */
function lex(text: string): Line[] {
  const lines: Line[] = [];
  let tokens: Token[] = [];
  let line = 1;
  let at = 0;
  while (at < text.length) {
    const ch = text[at] as string;
    plain(ch, line);
    if (ch === "\n") {
      if (tokens.length > 0) lines.push({ tokens, via: null });
      tokens = [];
      line += 1;
      at += 1;
    } else if (ch === " " || ch === "\t") {
      at += 1;
    } else if (ch === "#") {
      at = text.indexOf("\n", at) === -1 ? text.length : text.indexOf("\n", at);
    } else if (ch === '"' || ch === "`") {
      const end = quotedEnd(text, at, line);
      tokens.push({ text: text.slice(at + 1, end), quoted: true, line, env: null });
      at = end + 1;
    } else {
      const end = wordEnd(text, at, line);
      tokens.push({ text: text.slice(at, end), quoted: false, line, env: null });
      at = end;
    }
  }
  if (tokens.length > 0) lines.push({ tokens, via: null });
  return lines;
}

/** Refuses a character outside printable ASCII, tab and newline; comments, which Caddy skips, may hold any. */
function plain(ch: string, line: number): void {
  if (!/[\t\n\x20-\x7e]/.test(ch))
    fail(line, `unsupported character U+${ch.codePointAt(0)?.toString(16).padStart(4, "0")}`);
}

/** The index of the quote closing the word that opens at `start`, which must be followed by whitespace. */
function quotedEnd(text: string, start: number, line: number): number {
  const quote = text[start] as string;
  let at = start + 1;
  while (at < text.length && text[at] !== quote && text[at] !== "\n") {
    plain(text[at] as string, line);
    if (quote === '"' && text[at] === "\\") fail(line, "backslash inside a double-quoted word");
    at += 1;
  }
  if (text[at] !== quote) fail(line, "unterminated quote");
  if (at + 1 < text.length && !/\s/.test(text[at + 1] as string)) fail(line, "quoted word followed by text");
  return at;
}

/** The index after the unquoted word that starts at `start`. */
function wordEnd(text: string, start: number, line: number): number {
  if (text.startsWith("<<", start)) fail(line, "heredoc not supported");
  if (text[start] === "\\") fail(line, "backslash at the start of a word");
  let at = start;
  while (at < text.length && !/\s/.test(text[at] as string)) {
    plain(text[at] as string, line);
    // Caddy keeps `\x` as written inside a word, except before whitespace (a line continuation) or `<`.
    if (text[at] === "\\" && (at + 1 >= text.length || /[\s<]/.test(text[at + 1] as string))) {
      fail(line, "backslash before whitespace or <");
    }
    at += 1;
  }
  return at;
}

const isOpen = (token: Token): boolean => !token.quoted && token.text === "{";
const isClose = (line: Line): boolean =>
  line.tokens.length === 1 && !line.tokens[0]?.quoted && line.tokens[0]?.text === "}";
const isImport = (line: Line): boolean => !line.tokens[0]?.quoted && line.tokens[0]?.text === "import";

function word(token: Token): string {
  if (!token.quoted && (token.text === "{" || token.text === "}")) fail(token.line, "brace inside a line");
  if (/\{args/.test(token.text)) fail(token.line, `${token.text} outside a snippet`);
  return token.text;
}

function address(token: Token): string {
  if (token.text.includes(",")) fail(token.line, "a comma in a site address is not supported");
  return word(token);
}

/** The index of the `}` line closing the block whose body starts at `start`. */
function blockEnd(lines: Line[], start: number): number {
  let depth = 0;
  for (let at = start; at < lines.length; at++) {
    const line = lines[at] as Line;
    if (isClose(line)) {
      if (depth === 0) return at;
      depth -= 1;
    } else if (isOpen(line.tokens.at(-1) as Token)) {
      depth += 1;
    }
  }
  return fail(lines[start - 1]?.tokens[0]?.line ?? 0, "unclosed block");
}

/** The directives of the block whose body starts at `start`, and the index after its closing `}`. */
function readBlock(lines: Line[], start: number, expander: Expander, level: string): [Directive[], number] {
  const directives: Directive[] = [];
  let at = start;
  for (;;) {
    const line = lines[at];
    if (line === undefined) return fail(lines[start - 1]?.tokens[0]?.line ?? 0, "unclosed block");
    if (isClose(line)) return [directives, at + 1];
    if (isImport(line)) {
      lines.splice(at, 1, ...expand(line, expander));
      continue;
    }
    const [name, ...rest] = line.tokens as [Token, ...Token[]];
    if (name.env !== null) fail(name.line, `{$${name.env}} cannot name a directive`);
    const opens = isOpen(rest.at(-1) ?? name);
    const tokens = opens ? rest.slice(0, -1) : rest;
    const args = tokens.map((token) => word(token));
    const placeholders = tokens.map((token) => token.env);
    const directive = {
      name: word(name),
      args,
      placeholders,
      block: null as Directive[] | null,
      via: line.via,
      line: name.line,
    };
    checkDirective(name, args, level);
    if (opens) {
      const inner = name.text.startsWith("@") ? "@" : level === "site" && name.text === "route" ? "route" : name.text;
      [directive.block, at] = readBlock(lines, at + 1, expander, inner);
    } else {
      at += 1;
    }
    directives.push(directive);
  }
}

/** Refuses a directive the allowlist does not name at this level, and a placeholder outside where our files use it. */
function checkDirective(name: Token, args: readonly string[], level: string): void {
  if (name.quoted) fail(name.line, `quoted directive name "${name.text}" is not supported`);
  // Own keys only: a block named `constructor` or `__proto__` must not reach Object.prototype (P1.28l).
  const allowed = Object.hasOwn(DIRECTIVES, level) ? DIRECTIVES[level] : undefined;
  if (allowed === undefined) fail(name.line, `${level} does not take a block`);
  const data = allowed === "data";
  const key = name.text.startsWith("@") ? "@" : name.text;
  if (!data && !allowed.includes(key)) fail(name.line, `directive ${name.text} is not allowed in ${level}`);
  if (key === "@" && args.length > 0 && !MATCHERS.includes(args[0] as string)) {
    fail(name.line, `matcher ${args[0]} is not allowed`);
  }
  if (/[{}]/.test(name.text)) fail(name.line, `unsupported placeholder in ${name.text}`);
  // A matcher line names its matcher first (`@m vars_regexp …`, `not path …`); the placeholder belongs to that.
  const user = key === "@" || key === "not" ? (args[0] ?? key) : data ? level : key;
  for (const arg of args) {
    // A map entry's output may name a regexp capture (`${1}`), which is the map's own syntax, not a placeholder.
    if (!/[{}]/.test(user === "map" ? arg.replaceAll(/\$\{\d+\}/g, "") : arg)) continue;
    if (!PLACEHOLDERS[arg]?.includes(user)) fail(name.line, `unsupported placeholder ${arg} in ${name.text}`);
  }
}

type Expander = { snippets: Map<string, Line[]>; imports: number };

/** A snippet import's lines, `{args[N]}` replaced and marked with the snippet's name; anything else fails. */
function expand(line: Line, expander: Expander): Line[] {
  const [keyword, target, ...args] = line.tokens as [Token, Token | undefined, ...Token[]];
  if (target === undefined) return fail(keyword.line, "import without a target");
  if (target.env !== null) return fail(target.line, `{$${target.env}} cannot name a snippet`);
  const body = expander.snippets.get(target.text);
  if (target.quoted || body === undefined) {
    return fail(target.line, `import ${target.text} is not a snippet defined above (file imports are refused)`);
  }
  expander.imports += 1;
  if (expander.imports > MAX_IMPORTS) fail(target.line, "too many imports (a snippet imports itself?)");
  for (const token of args) word(token);
  return body.map((bodyLine) => ({
    via: line.via ?? target.text,
    tokens: bodyLine.tokens.map((token) => withArgs(token, args)),
  }));
}

/** A whole-word `{args[N]}` replaced by the import's Nth argument; any other `{args…}` use, or a missing one, fails. */
function withArgs(token: Token, args: readonly Token[]): Token {
  let env: EnvName | null = token.env;
  const text = token.text.replaceAll(/\{args([^}]*)\}/g, (whole, index: string) => {
    const n = /^\[(\d+)\]$/.exec(index)?.[1];
    const value = n === undefined ? undefined : args[Number(n)];
    if (value === undefined) fail(token.line, `{args${index}} has no value`);
    // A placeholder argument stays a whole word, so its position is still known (P1.28l).
    if (value.env !== null && whole !== token.text) fail(token.line, "an environment placeholder must be a whole word");
    // Caddy substitutes inside a word (v2.11.7 caddyconfig/caddyfile/parse.go:580), so a part-word argument could
    // assemble a word no raw token holds, such as a local-only leaf path; only a whole-word argument is read (P1.34b).
    if (whole !== token.text) fail(token.line, "a snippet argument must be a whole word");
    env = value.env ?? env;
    return value.text;
  });
  return { ...token, text, env };
}

/**
 * The file-system reads `readEdgeConfig` needs. The caller passes them in (node:fs in tests and the preflight), so this
 * file imports nothing and needs no dependency-cruiser row of its own. Each is one direct call with no policy: the
 * reader checks every answer itself (P1.28f).
 */
export type EdgeFiles = {
  /** The entry names of a directory. */
  list(dir: string): string[];
  /** What the path itself is (a final symlink is not followed), and its hard-link count. */
  kind(path: string): { type: "file" | "link" | "dir" | "other"; links: number };
  /** The path with every symlink resolved, or null when nothing is there. */
  realpath(path: string): string | null;
  read(path: string): string;
};

/** The Caddyfile's two file imports, matched as whole lines, and the one directory each reads. */
const FILE_IMPORTS = ["import snippets/*.caddy", "import sites/enabled/*.caddy"] as const;
/** A name `*.caddy` matches that sorts the same in JavaScript and in Go (ASCII), with no leading dot: Caddy skips
 * dotfiles a leading `*` matches (parse.go doImport, issue #5295), so one there would be read by us and not by it. */
const CADDY_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.caddy$/;

/**
 * How the edge's files are read: "shipped" as the image holds them, or "local" as the local stack's mounts place them
 * (P1.34a; architecture record 2026-10-12-refocus-local-signin-rulings, Amendment 2). Only C18 under --env local
 * passes "local" (P1.27l). It is a mode, not a path: it resolves to `edgeDir/local/` here, under the same containment
 * as sites/.
 */
export type EdgeMode = "shipped" | "local" | "dev";
/**
 * What a file may hold only when read from local/: the app site's placeholders and the dev leaf's secrets (P1.34c). A
 * token containing any of these fails anywhere else, so a leaf path spelled `/run/secrets//local_tls_cert` or through
 * `..` fails too, with no path normalising to get wrong (P1.34b). A prod app site is a later ruling.
 */
const LOCAL_ONLY = ["{$APP_HOST}", "{$APP_UPSTREAM}", "local_tls_"];
/** What a file read from dev/ may hold of LOCAL_ONLY: the app site's placeholders, never the local leaf (P1.36b). */
const DEV_ALLOWED = ["{$APP_HOST}", "{$APP_UPSTREAM}"];
/** The dev leaf's secret names, accepted only in files read from dev/ (P1.36b; ADR 0032). */
const DEV_ONLY = ["dev_tls_"];
/** The dev `(tls)` snippet's one line: the self-signed leaf and its key as the dev stack mounts them (ADR 0032). */
export const DEV_TLS = ["/run/secrets/dev_tls_cert", "/run/secrets/dev_tls_key"] as const;
/**
 * The dev stack's app site, exactly (P1.36b): ADR 0025's accepted app name, one string and not a suffix or pattern, and
 * the web address the local stack already pins. Prod has no app site until a ruling of its own.
 */
export const DEV_APP = { APP_HOST: "staging.unset.sh", APP_UPSTREAM: "web:8080" } as const;
/** The edge's address on newt_edge, the only address a dev site binds (ADR 0030 Decision 2; compose.dev.yaml, P1.37v). */
export const DEV_EDGE_ADDRESS = "10.250.37.3";
/** Newt's address on newt_edge, the dev edge's one trusted proxy (P1.36j; compose.dev.yaml, P1.37v). */
export const DEV_PROXY_ADDRESS = "10.250.37.2";
/** The listener the dev sites produce, and the only server whose options may trust a proxy (P1.36j). */
export const DEV_LISTENER = `${DEV_EDGE_ADDRESS}:443`;

/**
 * The edge's config as Caddy v2.11.7 reads it (P1.28e; architecture amendment 7 to
 * 2026-10-07-p130s-networks-and-caddyfile-reader): `edgeDir`'s Caddyfile with `import snippets/*.caddy` replaced by
 * `edgeDir/snippets` and `import sites/enabled/*.caddy` by the enabled sites, each in byte order (doImport uses
 * filepath.Glob, Caddy v2.11.7 caddyconfig/caddyfile/parse.go:445, whose glob() sorts the names, Go 1.27.2
 * src/path/filepath/match.go:320-336; it skips the dotfiles a leading `*` matches, parse.go:455-468). Each import
 * line must appear exactly once; an included file is not scanned for imports again, so any other file import reaches
 * readCaddyfile and fails.
 *
 * Containment (P1.28f; amendment 8, point 1): every path is resolved, and each resolved path must stay where it
 * belongs. In the shipped mode `sitesDir` lies inside `edgeDir/sites/` or is `sites/` itself, as the dev stack mounts it
 * (P1.34q); a snippet is a regular file inside `edgeDir/snippets/`; a site is a regular file, or a symlink to one,
 * inside `edgeDir/sites/`; none has a second hard link. Out of scope: hard links
 * beyond that count, and a file swapped between `kind` and `read`, since this is a build-time reader over a checkout.
 * Any error it throws carries no value from `env` (P1.30h).
 *
 * In the "local" mode (P1.34a, P1.34o), `local/app.caddy` is read as one more enabled site and `local/tls.caddy` in
 * place of `snippets/tls.caddy`, as the local stack's two read-only file mounts place them; each must be a regular file
 * inside local/, and no other file there is read (architecture record 2026-10-13-p127l-local-gaps, item 1). The local
 * mode takes the enabled sites only as a list of file mounts, checked by `mountedSites` (P1.34q; local-gaps Amendment 3
 * S2), and refuses a directory (P1.33n); C18 passes that list (P1.33y). The "dev" mode takes its sites the same way,
 * as exactly dev/app.caddy and dev/pds.caddy (ADR 0032 Decision 3). The shipped mode takes only a directory. In
 * either mode a file outside local/, the Caddyfile included, holding a LOCAL_ONLY part fails, and APP_HOST and
 * APP_UPSTREAM must differ from the PDS ones.
 */
export function readEdgeConfig(
  edgeDir: string,
  sitesDir: string | readonly SiteMount[],
  env: Env,
  files: EdgeFiles,
  mode: EdgeMode = "shipped",
): Caddyfile {
  return unechoed(env, () => readEdgeTree(edgeDir, sitesDir, env, files, mode));
}

/** One read-only file mount at /etc/caddy/sites/enabled/`name`: the host file it binds and its name there (P1.34q). */
export type SiteMount = { source: string; name: string };

/** `readEdgeConfig` before its errors are scrubbed. */
function readEdgeTree(
  edgeDir: string,
  sitesDir: string | readonly SiteMount[],
  env: Env,
  files: EdgeFiles,
  mode: EdgeMode,
): Caddyfile {
  if (typeof sitesDir !== "string" && mode === "shipped") {
    throw new CaddyfileError("site file mounts are read only in the local and dev modes");
  }
  if (typeof sitesDir === "string" && mode !== "shipped") {
    throw new CaddyfileError(`the ${mode} mode reads the enabled sites only as file mounts`);
  }
  distinctAppValues(env);
  if (mode === "dev") devAppValues(env);
  const root = resolved(files, edgeDir, "the edge directory");
  const sites: Bound = { path: `${root}/sites`, area: "sites/" };
  if (resolved(files, sites.path, "the sites directory") !== sites.path) {
    throw new CaddyfileError("sites/ leaves the edge directory");
  }
  const local: Bound = { path: `${root}/local`, area: "local/" };
  if (mode === "local" && resolved(files, local.path, "the local directory") !== local.path) {
    throw new CaddyfileError("local/ leaves the edge directory");
  }
  const dev: Bound = { path: `${root}/dev`, area: "dev/" };
  if (mode === "dev" && resolved(files, dev.path, "the dev directory") !== dev.path) {
    throw new CaddyfileError("dev/ leaves the edge directory");
  }
  // The shipped mode reads only sites/ or inside it, so a dev/ or local/ directory is refused under prod.
  if (typeof sitesDir === "string") {
    const enabled = resolved(files, sitesDir, "the enabled sites directory");
    if (enabled !== sites.path && !enabled.startsWith(`${sites.path}/`))
      throw new CaddyfileError("the enabled sites directory is not inside sites/");
  }
  const checked = (path: string, name: string) =>
    localOnlyChecked(files, path, name, local, mode === "dev" ? dev : null);
  const caddyfile = entry(files, root, "Caddyfile", [{ path: root, area: "the edge directory" }], false);
  const lines = checked(caddyfile, "Caddyfile").split("\n");
  for (const line of FILE_IMPORTS) {
    if (lines.filter((l) => l === line).length !== 1) {
      throw new CaddyfileError(`the Caddyfile must ${line} exactly once`);
    }
  }
  const snippets: Bound = { path: `${root}/snippets`, area: "snippets/" };
  const read: Reader = (dir, name, bounds, links) => {
    if (mode === "local" && dir === snippets.path && name === "tls.caddy") {
      return checked(entry(files, local.path, name, [local], false), name);
    }
    if (mode === "dev" && dir === snippets.path && name === "tls.caddy") {
      return checked(entry(files, dev.path, name, [dev], false), name);
    }
    return checked(entry(files, dir, name, bounds, links), name);
  };
  const expanded = lines.map((line) => {
    if (line === FILE_IMPORTS[0]) return globbed(files, snippets.path, [snippets], false, line, read);
    if (line === FILE_IMPORTS[1]) {
      if (typeof sitesDir !== "string") {
        const expected = mode === "dev" ? devSites(dev) : localSites(files, sites, local);
        return mountedSites(files, sitesDir, expected, mode, read);
      }
      return globbed(files, sitesDir, [sites], true, line, read);
    }
    return line;
  });
  return readCaddyfile(expanded.join("\n"), env);
}

/** The app's host and upstream must not be the PDS's: one host per site, and one site per upstream (P1.34a). */
function distinctAppValues(env: Env): void {
  for (const [app, pds] of [
    ["APP_HOST", "PDS_HOST"],
    ["APP_UPSTREAM", "PDS_UPSTREAM"],
  ] as const) {
    if (env[app] !== undefined && env[app] === env[pds]) throw new CaddyfileError(`{$${app}} equals {$${pds}}`);
  }
}

/** The dev app site's host and upstream, when given, are exactly DEV_APP's; anything else fails (P1.36b). */
function devAppValues(env: Env): void {
  for (const name of ["APP_HOST", "APP_UPSTREAM"] as const) {
    if (env[name] !== undefined && env[name] !== DEV_APP[name]) {
      throw new CaddyfileError(`{$${name}} is not the dev app site's ruled value`);
    }
  }
}

/**
 * The text of the file at `path`, which may hold a LOCAL_ONLY part only when it lies inside local/, or DEV_ALLOWED's
 * parts inside `dev` when the dev mode reads it (null otherwise).
 */
function localOnlyChecked(files: EdgeFiles, path: string, name: string, local: Bound, dev: Bound | null): string {
  const text = files.read(path);
  const inLocal = path.startsWith(`${local.path}/`);
  const inDev = dev !== null && path.startsWith(`${dev.path}/`);
  const allowed = inDev ? DEV_ALLOWED : [];
  for (const line of lex(text)) {
    const has = (token: Token, parts: readonly string[]) => parts.some((part) => token.text.includes(part));
    const local = line.tokens.find(
      (t) =>
        !inLocal &&
        has(
          t,
          LOCAL_ONLY.filter((part) => !allowed.includes(part)),
        ),
    );
    if (local !== undefined) throw new CaddyfileError(`${name}: ${local.text} is allowed only in local/`);
    const devWord = line.tokens.find((t) => !inDev && has(t, DEV_ONLY));
    if (devWord !== undefined) throw new CaddyfileError(`${name}: ${devWord.text} is allowed only in dev/`);
  }
  return text;
}

/** An absolute path whose every segment is a name: no empty, `.` or `..` segment and no trailing slash. */
const NORMAL_PATH = /^(?:\/(?!\.{1,2}(?:\/|$))[^/]+)+$/;

/**
 * The adapter's real path for `path`, which must exist and be absolute and normal: no empty, `.` or `..` segment and
 * no trailing slash, so it equals `path.normalize` of itself (amendment 8, point 1).
 */
function resolved(files: EdgeFiles, path: string, what: string): string {
  const real = files.realpath(path);
  if (real === null) throw new CaddyfileError(`${what}: nothing is there`);
  if (real !== "/" && !NORMAL_PATH.test(real)) {
    throw new CaddyfileError(`${what} resolves to a path that is not absolute and normal`);
  }
  return real;
}

/** A directory an entry may resolve inside, and how a message names it. */
type Bound = { path: string; area: string };
/** How `globbed` reads one entry of a directory. */
type Reader = (dir: string, name: string, bounds: Bound[], links: boolean) => string;
const areas = (bounds: Bound[]): string => bounds.map((bound) => bound.area).join(" and ");

/** The one file the local stack mounts into the enabled sites, from local/ (P1.34o). */
const MOUNTED_SITE = "app.caddy";

/** The text of every entry of `dir` in byte order, each read through `read`, which checks where it resolves. */
function globbed(files: EdgeFiles, dir: string, bounds: Bound[], links: boolean, line: string, read: Reader): string {
  const names = files.list(dir);
  if (names.length === 0) throw new CaddyfileError(`${line} matches nothing`);
  return names
    .sort()
    .map((name) => {
      if (!CADDY_FILE.test(name)) throw new CaddyfileError(`${name}: not a .caddy file`);
      return read(dir, name, bounds, links);
    })
    .join("\n");
}

/** The sites the dev stack mounts, each from dev/ by its own name (ADR 0032 Decision 3), and nothing else. */
const DEV_SITES = ["app.caddy", "pds.caddy"] as const;

/** The local stack's sites by name: every `*.caddy` in sites/, plus local/app.caddy as MOUNTED_SITE (P1.34q). */
function localSites(files: EdgeFiles, sites: Bound, local: Bound): Map<string, Bound> {
  const expected = new Map<string, Bound>();
  for (const name of files.list(sites.path).filter((n) => n.endsWith(".caddy"))) expected.set(name, sites);
  if (expected.has(MOUNTED_SITE)) {
    throw new CaddyfileError(`${MOUNTED_SITE}: an enabled site has the mounted app site's name`);
  }
  expected.set(MOUNTED_SITE, local);
  return expected;
}

/** The dev stack's sites by name: exactly DEV_SITES, each from dev/; no shipped site. */
const devSites = (dev: Bound): Map<string, Bound> => new Map(DEV_SITES.map((name) => [name, dev]));

/**
 * The text of the enabled sites, given as file mounts (P1.34q; architecture record 2026-10-13-p127l-local-gaps,
 * Amendment 3 S2; dev since P1.36b): exactly one mount for every name in `expected`, from its own area, and nothing
 * else. Each source is the regular file itself, never a link or a directory, so the mount binds what the reader reads;
 * then each is read in byte order, as Caddy's glob over the mount targets reads them, under `entry`'s containment and
 * hard-link rules.
 */
function mountedSites(
  files: EdgeFiles,
  mounts: readonly SiteMount[],
  expected: ReadonlyMap<string, Bound>,
  mode: EdgeMode,
  read: Reader,
): string {
  const seen = new Set<string>();
  for (const { source, name } of mounts) {
    if (files.kind(source).type !== "file") throw new CaddyfileError(`${name}: the mount is not one regular file`);
    const bound = expected.get(name);
    if (bound === undefined) throw new CaddyfileError(`${name}: not a site the ${mode} stack mounts`);
    if (resolved(files, source, name) !== `${bound.path}/${name}`) {
      throw new CaddyfileError(`${name}: not mounted from ${bound.area}${name}`);
    }
    if (seen.has(name)) throw new CaddyfileError(`${name}: mounted more than once`);
    seen.add(name);
  }
  const names = [...expected.keys()].sort();
  for (const name of names) if (!seen.has(name)) throw new CaddyfileError(`${name}: not mounted`);
  return names
    .map((name) => {
      if (!CADDY_FILE.test(name)) throw new CaddyfileError(`${name}: not a .caddy file`);
      const bound = expected.get(name) as Bound;
      return read(bound.path, name, [bound], false);
    })
    .join("\n");
}

/**
 * Where `dir/name` really is: a regular file with one hard link whose resolved path lies inside one of `bounds`. When
 * `links` is true it may also be a symlink to such a file; the link's own place does not matter, only where it leads.
 */
function entry(files: EdgeFiles, dir: string, name: string, bounds: Bound[], links: boolean): string {
  const path = `${dir}/${name}`;
  const own = files.kind(path).type;
  if (own !== "file" && !(own === "link" && links)) throw new CaddyfileError(`${name}: not a regular file`);
  if (own === "link" && files.realpath(path) === null) throw new CaddyfileError(`${name}: dangling link`);
  const target = resolved(files, path, name);
  if (!bounds.some((bound) => target.startsWith(`${bound.path}/`))) {
    const area = areas(bounds);
    throw new CaddyfileError(
      own === "link" ? `${name}: the link leaves ${area}` : `${name}: the file is not inside ${area}`,
    );
  }
  const real = files.kind(target);
  if (real.type !== "file" || (own === "link" && !target.endsWith(".caddy"))) {
    throw new CaddyfileError(`${name}: the link target is not a regular file`);
  }
  if (real.links !== 1) throw new CaddyfileError(`${name}: the file has ${real.links} hard links`);
  return target;
}

/** The client address headers the edge removes before every upstream (ADR 0018). */
const ADDRESS_HEADERS = ["X-Forwarded-For", "X-Real-IP", "Forwarded"];
/** A site address that only loopback can reach by name: `127.0.0.1:<port>` or `[::1]:<port>`, optionally http://. */
const LOOPBACK_ADDRESS = /^(?:http:\/\/)?(?:127\.0\.0\.1|\[::1\]):\d{1,5}$/;
const LOOPBACK_BIND = ["127.0.0.1", "::1"];

const flatten = (directives: Directive[]): Directive[] =>
  directives.flatMap((directive) => [directive, ...flatten(directive.block ?? [])]);
const named = (directives: Directive[], name: string): Directive[] => directives.filter((d) => d.name === name);

/**
 * Why some request could reach an upstream uncounted or carrying a client address; empty when none can (P1.28e;
 * architecture amendment 7, point 3). The pds-ratelimit snippet holds one rate_limit block whose global zone has no
 * matcher. Every site with a reverse_proxy has exactly one plain route that applies that snippet first, holds every
 * reverse_proxy of the site, and is the site's only rate_limit; each reverse_proxy removes the address headers and
 * sets none again. A site with no reverse_proxy is
 * exempt because it has no `reverse_proxy`, not because of its name or address;
 * it must still be bound to loopback and named for it, or it is a public site without rate limit. At most one site may
 * proxy a given upstream (P1.28f; amendment 8, point 4), so each upstream sits behind one site's rules. Zone state is
 * shared across sites by zone name: caddy-ratelimit at the pinned 5625512f24f6 keeps each zone's limiters in one
 * process-wide pool keyed by its name (ratelimit.go:92-96, handler.go:385). So every site importing pds-ratelimit
 * spends the same per-client budgets; the local app site does, which Amendment 2 of
 * unset-plan/book-edits/2026-10-12-refocus-local-signin-rulings.md accepts for local only, and a prod app site gets its
 * own zone (Amendment 5, F3).
 *
 * Each env placeholder sits only in its position in PLACEHOLDER_POSITIONS, every upstream is a placeholder, and a
 * literal site address is loopback (P1.28l; amendment 9). Messages name a site by its addresses as written.
 */
export function edgeSiteProblems(config: Caddyfile, mode: EdgeMode = "shipped"): string[] {
  const found = [
    ...zoneProblems(config, "pds-ratelimit", "global"),
    ...zoneProblems(config, "app-ratelimit", "app_global"),
    ...positionProblems(config.global ?? [], "the global options", null),
    ...(mode === "dev" ? devTlsProblems(config) : []),
    ...proxyProblems(config.global ?? []),
  ];
  const proxied = new Set<string>();
  for (const site of config.sites) {
    const zones = mode === "dev" && hostOf(site) === "APP_HOST" ? "app-ratelimit" : "pds-ratelimit";
    found.push(...addressProblems(site), ...siteProblems(site, zones), ...schemeProblems(site, mode));
    found.push(...positionProblems(site.directives, siteName(site), hostOf(site)));
    const proxies = named(flatten(site.directives), "reverse_proxy");
    const upstreams = new Set(proxies.map(upstreamOf).filter((upstream) => upstream !== null));
    if ([...upstreams].some((upstream) => proxied.has(upstream))) {
      found.push(`${siteName(site)}: upstream proxied by more than one site`);
    }
    for (const upstream of upstreams) proxied.add(upstream);
  }
  return found;
}

/** A site as messages name it: its addresses as written, `{$NAME}` for a placeholder, never the value (P1.28l). */
function siteName(site: Site): string {
  return site.addresses
    .map((address, at) => {
      const env = site.placeholders[at];
      return env === null || env === undefined ? address : `{$${env}}`;
    })
    .join(" ");
}

/**
 * A zones snippet holds one rate_limit block whose `global` zone has no matcher, so every route of a site importing it
 * is counted. Messages name the PDS's snippet as "the zones snippet", as before P1.36b, and the app's by its name.
 */
function zoneProblems(config: Caddyfile, snippet: string, global: string): string[] {
  const label = snippet === "pds-ratelimit" ? "the zones snippet" : `the ${snippet} snippet`;
  const zone = global === "global" ? "global zone" : `${global} zone`;
  let directives: Directive[];
  try {
    directives = config.snippet(snippet);
  } catch (error) {
    if (error instanceof CaddyfileError) return [`${label} is unreadable: ${error.message}`];
    throw error;
  }
  const limits = named(directives, "rate_limit");
  const found = positionProblems(directives, label, null);
  if (limits.length !== 1) found.push(`${label} holds ${limits.length} rate_limit blocks`);
  const unmatched = named(limits[0]?.block ?? [], "zone").find((z) => z.args[0] === global);
  if (unmatched === undefined) found.push(`there is no ${zone}`);
  else if (named(unmatched.block ?? [], "match").length > 0) found.push(`the ${zone} has a matcher`);
  for (const each of named(limits[0]?.block ?? [], "zone")) {
    const keys = named(each.block ?? [], "key");
    if (keys.length !== 1 || keys[0]?.args.join(" ") !== "{client_ip}") {
      found.push(`the ${each.args[0]} zone is not keyed on {client_ip}`);
    }
  }
  return found;
}

/**
 * The trusted proxy (P1.36j; ADR 0030 Decision 2): one `servers` block for DEV_LISTENER trusts exactly Newt's address,
 * reads X-Forwarded-For alone, right to left, and keeps the shared timeouts; the one unscoped block trusts nothing.
 * Prod and local bind no site to the dev address (schemeProblems), so the dev block applies to no server there.
 */
function proxyProblems(global: Directive[]): string[] {
  const servers = named(global, "servers");
  const shared = servers.filter((block) => block.args.length === 0);
  const dev = servers.filter((block) => block.args.join(" ") === DEV_LISTENER);
  const found = servers
    .filter((block) => !shared.includes(block) && !dev.includes(block))
    .map((block) => `servers ${block.args.join(" ")}: only ${DEV_LISTENER} may have its own options`);
  if (shared.length !== 1 || dev.length !== 1)
    return [...found, `not one shared and one ${DEV_LISTENER} servers block`];
  const trusts = (block: Directive) =>
    (block.block ?? []).filter((d) => d.name.startsWith("trusted_proxies") || d.name === "client_ip_headers");
  if (trusts(shared[0] as Directive).length > 0) found.push("the shared servers block trusts a proxy");
  const options = (dev[0] as Directive).block ?? [];
  const line = (name: string) => named(options, name).map((d) => d.args.join(" "));
  if (line("trusted_proxies").join("|") !== `static ${DEV_PROXY_ADDRESS}/32`) {
    found.push(`${DEV_LISTENER} does not trust exactly ${DEV_PROXY_ADDRESS}`);
  }
  const strict = line("trusted_proxies_strict");
  if (strict.length !== 1 || strict[0] !== "") found.push(`${DEV_LISTENER} does not read right to left`);
  if (line("client_ip_headers").join("|") !== "X-Forwarded-For") {
    found.push(`${DEV_LISTENER} reads a header other than X-Forwarded-For`);
  }
  if (
    JSON.stringify(blockText(named(options, "timeouts"))) !==
    JSON.stringify(blockText(named(shared[0]?.block ?? [], "timeouts")))
  ) {
    found.push(`${DEV_LISTENER} does not keep the shared timeouts`);
  }
  return found;
}

/** Directives as comparable text: names, arguments and blocks, without lines or provenance. */
const blockText = (directives: Directive[]): unknown[] =>
  directives.map((d) => [d.name, d.args, d.block === null ? null : blockText(d.block)]);

/**
 * The dev shape (P1.36b; ADR 0032): under dev every public site is its bare host placeholder (https), bound to
 * DEV_EDGE_ADDRESS alone, importing the dev `(tls)`, the security headers and noindex; the PDS site keeps
 * the admin guard, and the app site refuses writes to the sign-in files. No dev site is plain http, so there is no
 * :80 site (ADR 0032 Decision 4); outside dev a site is never plain http either, and prod serves no file certificate.
 */
function schemeProblems(site: Site, mode: EdgeMode): string[] {
  const name = siteName(site);
  const host = hostOf(site);
  if (host === null) return [];
  const plain = site.addresses.every((address) => address.startsWith("http://"));
  if (mode !== "dev") {
    // The local leaf's paths are confined to local/ by the reader (LOCAL_ONLY); any other file pair is refused.
    const files = named(flatten(site.directives), "tls").some(
      (tls) => tls.args.length > 1 && !tls.args.every((arg) => arg.startsWith("/run/secrets/local_tls_")),
    );
    const devBound = named(site.directives, "bind").some((bind) => bind.args.includes(DEV_EDGE_ADDRESS));
    return [
      ...(plain ? [`${name}: a plain-http site outside dev`] : []),
      ...(files ? [`${name}: a file certificate outside dev and local`] : []),
      ...(devBound ? [`${name}: bound to the dev edge address outside dev`] : []),
    ];
  }
  const found = site.addresses.some((address) => address.startsWith("http://"))
    ? [`${name}: a plain-http dev site`]
    : [];
  const binds = named(site.directives, "bind");
  if (binds.length !== 1 || binds[0]?.args.join(" ") !== DEV_EDGE_ADDRESS) {
    found.push(`${name}: not bound to the edge's newt_edge address alone`);
  }
  const certificates = named(flatten(site.directives), "tls");
  if (certificates.length !== 1 || certificates[0]?.via !== "tls") {
    found.push(`${name}: a certificate other than the dev (tls)`);
  }
  const route = named(site.directives, "route")[0]?.block ?? [];
  const required: [Directive[], string][] = [
    [site.directives, "tls"],
    [site.directives, "security-headers"],
    [site.directives, "noindex"],
  ];
  if (host === "PDS_HOST") required.push([route, "xrpc-guard"]);
  if (host === "APP_HOST") required.push([route, "signin-files"]);
  for (const [block, snippet] of required) {
    if (!block.some((directive) => directive.via === snippet)) found.push(`${name}: does not import ${snippet}`);
  }
  return found;
}

/**
 * The dev `(tls)` (ADR 0032 Decision 1): exactly `tls <cert_file> <key_file>` with DEV_TLS's two paths, the local
 * stack's shape. No issuer block, no `internal`, no other line.
 */
function devTlsProblems(config: Caddyfile): string[] {
  const lines = config.snippet("tls").map((d) => [d.name, ...d.args, ...(d.block === null ? [] : ["{"])].join(" "));
  return lines.join("\n") === ["tls", ...DEV_TLS].join(" ")
    ? []
    : ["the dev (tls) is not the self-signed leaf's files"];
}

/** The host placeholder a site is written as, or null when it has none. */
const hostOf = (site: Site): EnvName | null =>
  site.placeholders.find((env) => env !== null && HOSTS.includes(env)) ?? null;

/** Only a host placeholder may be a site address, alone; a literal address is loopback, on a site with no upstream. */
function addressProblems(site: Site): string[] {
  const name = siteName(site);
  const found: string[] = [];
  const host = hostOf(site);
  if (host !== null && site.addresses.length !== 1)
    found.push(`${name}: {$${host}} shares its site with another address`);
  site.addresses.forEach((address, at) => {
    const env = site.placeholders[at] ?? null;
    if (env !== null && !HOSTS.includes(env)) found.push(`${name}: {$${env}} is not a site address`);
    if (env === null && !LOOPBACK_ADDRESS.test(address)) found.push(`${name}: a literal site address is not loopback`);
  });
  if (host === null && named(flatten(site.directives), "reverse_proxy").length > 0) {
    found.push(`${name}: a site other than {$PDS_HOST} or {$APP_HOST} has an upstream`);
  }
  return found;
}

/**
 * Where each env placeholder may be written (P1.28l; architecture amendment 9 to
 * 2026-10-07-p130s-networks-and-caddyfile-reader, and the P1.28l record, final 01:55Z, corrected 02:00Z):
 * `{$PDS_UPSTREAM}` as the upstream of a reverse_proxy on the `{$PDS_HOST}` site, `{$ACME_EMAIL}` as the `email` of
 * an `issuer acme` in a `tls` block at the block root (snippets/tls.caddy). `{$PDS_HOST}` is a site address only
 * (addressProblems). Adding a position is a trusted change; widening one loosens. P1.34a mirrors the PDS pair for the
 * local app site: `{$APP_HOST}` a site address only, `{$APP_UPSTREAM}` the upstream on the `{$APP_HOST}` site.
 */
const PLACEHOLDER_POSITIONS: Readonly<Record<EnvName, (at: Position) => boolean>> = {
  PDS_HOST: () => false,
  PDS_UPSTREAM: (at) => at.host === "PDS_HOST" && isUpstream(at),
  APP_HOST: () => false,
  APP_UPSTREAM: (at) => at.host === "APP_HOST" && isUpstream(at),
  ACME_EMAIL: ({ directive, arg, parents }) => {
    // The chain from the block root, so a data block (header, map, fields) that opens a level named tls or issuer
    // cannot hold it (coordinator verification of #552).
    const [tls, issuer] = parents;
    return (
      directive.name === "email" &&
      arg === 0 &&
      directive.args.length === 1 &&
      issuer?.name === "issuer" &&
      issuer.args.length === 1 &&
      issuer.args[0] === "acme" &&
      tls?.name === "tls"
    );
  },
};
/** Where a placeholder is: its directive, argument, enclosing directives, and the host of the site it is on. */
type Position = { directive: Directive; arg: number; parents: Directive[]; host: EnvName | null };
/** The placeholder is a reverse_proxy's one upstream, its last argument. */
const isUpstream = ({ directive, arg }: Position): boolean =>
  directive.name === "reverse_proxy" && arg === directive.args.length - 1 && upstreamOf(directive) !== null;

/** Every placeholder in `directives` (at any depth) that is outside its position, named for `owner`. */
function positionProblems(
  directives: Directive[],
  owner: string,
  host: EnvName | null,
  parents: Directive[] = [],
): string[] {
  return directives.flatMap((directive) => [
    ...directive.placeholders.flatMap((env, arg) =>
      env === null || PLACEHOLDER_POSITIONS[env]({ directive, arg, parents, host })
        ? []
        : [`${owner}: {$${env}} is outside its position in ${directive.name}`],
    ),
    ...positionProblems(directive.block ?? [], owner, host, [...parents, directive]),
  ]);
}

function siteProblems(site: Site, zones: string): string[] {
  const name = siteName(site);
  const all = flatten(site.directives);
  const proxies = named(all, "reverse_proxy");
  if (proxies.length === 0) return loopbackOnly(site) ? [] : [`${name}: public site without rate limit`];
  const found = [];
  const routes = named(site.directives, "route");
  const route = routes.length === 1 && routes[0]?.args.length === 0 ? routes[0] : undefined;
  if (route === undefined) found.push(`${name}: not exactly one plain route`);
  const first = route?.block?.[0];
  if (first?.name !== "rate_limit" || first.via !== zones) {
    found.push(`${name}: the route does not apply the zones first`);
  }
  if (named(flatten(route?.block ?? []), "reverse_proxy").length !== proxies.length) {
    found.push(`${name}: a reverse_proxy is outside the route`);
  }
  if (proxies.some((proxy) => upstreamOf(proxy) === null)) {
    found.push(`${name}: a reverse_proxy does not name one placeholder upstream`);
  }
  const limits = named(all, "rate_limit").length;
  if (limits !== 1) found.push(`${name}: ${limits} rate_limit blocks`);
  for (const header of ADDRESS_HEADERS) {
    if (proxies.some((proxy) => passes(proxy, header))) found.push(`${name}: a reverse_proxy passes ${header}`);
  }
  if (proxies.some((proxy) => !forwardsOwnHost(proxy))) found.push(`${name}: a reverse_proxy passes X-Forwarded-Host`);
  return found;
}

/**
 * Whether `proxy` sets X-Forwarded-Host to the request's own Host, once, and touches it nowhere else (P1.36j). Caddy
 * v2.11.7 keeps an incoming X-Forwarded-Host from a trusted proxy instead of setting it from Host
 * (reverseproxy.go:1012-1022), and under dev Newt is trusted, so without this the upstream would get Traefik's value.
 */
function forwardsOwnHost(proxy: Directive): boolean {
  const ups = named(proxy.block ?? [], "header_up").filter(
    (up) => up.args[0]?.replace(/^[+-]/, "").toLowerCase() === "x-forwarded-host",
  );
  return ups.length === 1 && ups[0]?.args.join(" ") === "X-Forwarded-Host {host}";
}

/**
 * The placeholder `proxy` names as its one upstream, after an optional matcher token (`@name`, a path or `*`), or null
 * when it names none, several, or a literal (P1.28l; amendment 9, point 2: a literal host, an IP literal, `localhost`
 * or a service name written out could alias the placeholder's value, so none is accepted).
 */
function upstreamOf(proxy: Directive): EnvName | null {
  const first = proxy.args[0] ?? "";
  const from =
    (first.startsWith("@") || first.startsWith("/") || first === "*") && proxy.placeholders[0] === null ? 1 : 0;
  return proxy.args.length === from + 1 ? (proxy.placeholders[from] ?? null) : null;
}

/** Whether `proxy` lacks `header_up -<header>` or sets the header again in any letter case. */
function passes(proxy: Directive, header: string): boolean {
  const ups = named(proxy.block ?? [], "header_up");
  const removed = ups.some((up) => up.args.length === 1 && up.args[0] === `-${header}`);
  const setAgain = ups.some(
    (up) => up.args[0] !== `-${header}` && up.args[0]?.replace(/^[+-]/, "").toLowerCase() === header.toLowerCase(),
  );
  return !removed || setAgain;
}

/** A site Caddy listens for on loopback only (`bind`) and that names only loopback addresses. */
function loopbackOnly(site: Site): boolean {
  const binds = named(site.directives, "bind");
  return (
    binds.length > 0 &&
    binds.every((bind) => bind.args.length > 0 && bind.args.every((arg) => LOOPBACK_BIND.includes(arg))) &&
    site.addresses.every((address) => LOOPBACK_ADDRESS.test(address))
  );
}
