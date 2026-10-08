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

/** One directive line with its arguments, its block if it opens one, and the snippet it was imported from. */
export type Directive = {
  name: string;
  args: string[];
  block: Directive[] | null;
  /** The snippet whose import produced this directive at this level, or null when written in place. */
  via: string | null;
  line: number;
};
export type Site = { addresses: string[]; directives: Directive[] };
export type Caddyfile = {
  global: Directive[] | null;
  sites: Site[];
  /** A snippet's body read as a block, with `args` in place of `{args[N]}`. */
  snippet(name: string, args?: readonly string[]): Directive[];
};

export class CaddyfileError extends Error {}

/** The `{$NAME}` placeholders the edge's files may use, each with the shape its value must have. */
export const ENV_NAMES = {
  PDS_HOST: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
  PDS_UPSTREAM: /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?:\d{1,5}$/,
  ACME_EMAIL: /^[A-Za-z0-9._%+-]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/,
} as const;
export type EnvName = keyof typeof ENV_NAMES;

/** Each runtime placeholder our files use, and the directives (or matchers) that may take it as an argument. */
const PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  "{http.request.orig_uri}": ["map", "vars_regexp"],
  "{route_class}": ["map", "log_append"],
  "{remote_host}": ["key"],
};

const MATCHERS = ["path", "method", "not", "path_regexp", "header_regexp", "vars_regexp"];
/**
 * The directives allowed in each block: `global`, `site`, `route` and `snippet` (a snippet read on its own), then the
 * block of a named directive. "data" blocks hold names our config chooses (header fields, log fields, map entries).
 */
const DIRECTIVES: Readonly<Record<string, readonly string[] | "data">> = {
  global: ["admin", "persist_config", "log", "servers"],
  site: ["bind", "respond", "tls", "log", "map", "log_append", "header", "route"],
  route: ["@", "rate_limit", "respond", "reverse_proxy"],
  snippet: ["@", "log", "rate_limit", "map", "log_append", "header", "tls", "reverse_proxy", "respond"],
  "@": MATCHERS,
  log: ["output", "level", "exclude", "format"],
  format: ["wrap", "fields"],
  fields: "data",
  servers: ["timeouts"],
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

type Token = { text: string; quoted: boolean; line: number };
type Line = { tokens: Token[]; via: string | null };
type Env = Readonly<Partial<Record<EnvName, string>>>;

/** The env values a message may never carry: only the site address (PDS_HOST) may appear (amendment 8, point 5). */
const UNECHOED: readonly EnvName[] = ["ACME_EMAIL", "PDS_UPSTREAM"];

/** `run`'s result; a reader error it throws comes back with each UNECHOED value replaced by its placeholder. */
function unechoed<T>(env: Env, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof CaddyfileError)) throw error;
    const message = UNECHOED.reduce((text, name) => {
      const value = env[name];
      return value === undefined || value === "" ? text : text.replaceAll(value, `{$${name}}`);
    }, error.message);
    throw new CaddyfileError(message);
  }
}

/** At most this many snippet expansions in one read: a snippet that imports itself fails instead of looping. */
const MAX_IMPORTS = 1000;

/**
 * The Caddyfile `text` with `env` put in. A reader error never carries an UNECHOED value, from the read or from a later
 * `snippet()` (P1.28f; amendment 8, point 5).
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
    const addresses = line.tokens.slice(0, -1).map((token) => address(token));
    let directives: Directive[];
    [directives, at] = readBlock(lines, at + 1, expander, "site");
    sites.push({ addresses, directives });
  }
  const snippet = (name: string, args: readonly string[] = []): Directive[] => {
    const body = snippets.get(name);
    if (body === undefined) throw new CaddyfileError(`no snippet ${name}`);
    const copy = body.map((line) => ({ via: line.via, tokens: line.tokens.map((t) => withArgs(t, args)) }));
    copy.push({ via: null, tokens: [{ text: "}", quoted: false, line: 0 }] });
    return readBlock(copy, 0, expander, "snippet")[0];
  };
  return { global, sites, snippet };
}

function fail(line: number, why: string): never {
  throw new CaddyfileError(`line ${line}: ${why}`);
}

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
  return { ...token, text };
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
      tokens.push({ text: text.slice(at + 1, end), quoted: true, line });
      at = end + 1;
    } else {
      const end = wordEnd(text, at, line);
      tokens.push({ text: text.slice(at, end), quoted: false, line });
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
    const opens = isOpen(rest.at(-1) ?? name);
    const args = (opens ? rest.slice(0, -1) : rest).map((token) => word(token));
    const directive = { name: word(name), args, block: null as Directive[] | null, via: line.via, line: name.line };
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
  const allowed = DIRECTIVES[level];
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
  const body = expander.snippets.get(target.text);
  if (target.quoted || body === undefined) {
    return fail(target.line, `import ${target.text} is not a snippet defined above (file imports are refused)`);
  }
  expander.imports += 1;
  if (expander.imports > MAX_IMPORTS) fail(target.line, "too many imports (a snippet imports itself?)");
  const values = args.map((token) => word(token));
  return body.map((bodyLine) => ({
    via: line.via ?? target.text,
    tokens: bodyLine.tokens.map((token) => withArgs(token, values)),
  }));
}

/** `{args[N]}` replaced by the import's Nth argument; any other `{args…}` form, or a missing argument, fails. */
function withArgs(token: Token, args: readonly string[]): Token {
  const text = token.text.replaceAll(/\{args([^}]*)\}/g, (_, index: string) => {
    const n = /^\[(\d+)\]$/.exec(index)?.[1];
    const value = n === undefined ? undefined : args[Number(n)];
    if (value === undefined) fail(token.line, `{args${index}} has no value`);
    return value;
  });
  return { ...token, text };
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
 * The edge's config as Caddy v2.11.7 reads it (P1.28e; architecture amendment 7 to
 * 2026-10-07-p130s-networks-and-caddyfile-reader): `edgeDir`'s Caddyfile with `import snippets/*.caddy` replaced by
 * `edgeDir/snippets` and `import sites/enabled/*.caddy` by `sitesDir`, each in byte order (doImport uses
 * filepath.Glob, whose glob() sorts the names, go src/path/filepath/match.go). Each import line must appear exactly
 * once; an included file is not scanned for imports again, so any other file import reaches readCaddyfile and fails.
 *
 * Containment (P1.28f; amendment 8, point 1): every path is resolved, and each resolved path must stay where it
 * belongs. `sitesDir` lies inside `edgeDir/sites/`; a snippet is a regular file inside `edgeDir/snippets/`; a site is
 * a regular file, or a symlink to one, inside `edgeDir/sites/`; none has a second hard link. Out of scope: hard links
 * beyond that count, and a file swapped between `kind` and `read`, since this is a build-time reader over a checkout.
 */
export function readEdgeConfig(edgeDir: string, sitesDir: string, env: Env, files: EdgeFiles): Caddyfile {
  const root = resolved(files, edgeDir, "the edge directory");
  const sitesRoot = `${root}/sites`;
  if (resolved(files, sitesRoot, "the sites directory") !== sitesRoot) {
    throw new CaddyfileError("sites/ leaves the edge directory");
  }
  if (!resolved(files, sitesDir, "the enabled sites directory").startsWith(`${sitesRoot}/`)) {
    throw new CaddyfileError("the enabled sites directory is not inside sites/");
  }
  const lines = files
    .read(entry(files, root, "Caddyfile", { path: root, area: "the edge directory" }, false))
    .split("\n");
  for (const line of FILE_IMPORTS) {
    if (lines.filter((l) => l === line).length !== 1) {
      throw new CaddyfileError(`the Caddyfile must ${line} exactly once`);
    }
  }
  const expanded = lines.map((line) => {
    if (line === FILE_IMPORTS[0])
      return globbed(files, `${root}/snippets`, { path: `${root}/snippets`, area: "snippets/" }, false, line);
    if (line === FILE_IMPORTS[1]) return globbed(files, sitesDir, { path: sitesRoot, area: "sites/" }, true, line);
    return line;
  });
  return readCaddyfile(expanded.join("\n"), env);
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

/** A directory every entry must resolve inside, and how a message names it. */
type Bound = { path: string; area: string };

/** The text of every entry of `dir` in byte order, each checked to resolve inside `bound`. */
function globbed(files: EdgeFiles, dir: string, bound: Bound, links: boolean, line: string): string {
  const names = files.list(dir).sort();
  if (names.length === 0) throw new CaddyfileError(`${line} matches nothing`);
  return names
    .map((name) => {
      if (!CADDY_FILE.test(name)) throw new CaddyfileError(`${name}: not a .caddy file`);
      return files.read(entry(files, dir, name, bound, links));
    })
    .join("\n");
}

/**
 * Where `dir/name` really is: a regular file with one hard link whose resolved path lies inside `bound`. When `links`
 * is true it may also be a symlink to such a file; the link's own place does not matter, only where it leads.
 */
function entry(files: EdgeFiles, dir: string, name: string, bound: Bound, links: boolean): string {
  const path = `${dir}/${name}`;
  const own = files.kind(path).type;
  if (own !== "file" && !(own === "link" && links)) throw new CaddyfileError(`${name}: not a regular file`);
  if (own === "link" && files.realpath(path) === null) throw new CaddyfileError(`${name}: dangling link`);
  const target = resolved(files, path, name);
  if (!target.startsWith(`${bound.path}/`)) {
    throw new CaddyfileError(
      own === "link" ? `${name}: the link leaves ${bound.area}` : `${name}: the file is not inside ${bound.area}`,
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
 * proxy a given upstream (P1.28f; amendment 8, point 4): until shared zone state across sites is proven, two sites on
 * one upstream would each count their clients separately.
 */
export function edgeSiteProblems(config: Caddyfile): string[] {
  const found = zoneProblems(config);
  const proxied = new Set<string>();
  for (const site of config.sites) {
    found.push(...siteProblems(site));
    const proxies = named(flatten(site.directives), "reverse_proxy");
    const upstreams = new Set(proxies.map(upstreamOf).filter((upstream) => upstream !== null));
    if ([...upstreams].some((upstream) => proxied.has(upstream))) {
      found.push(`${site.addresses.join(" ")}: upstream proxied by more than one site`);
    }
    for (const upstream of upstreams) proxied.add(upstream);
  }
  return found;
}

function zoneProblems(config: Caddyfile): string[] {
  let limits: Directive[];
  try {
    limits = named(config.snippet("pds-ratelimit"), "rate_limit");
  } catch (error) {
    if (error instanceof CaddyfileError) return [`the zones snippet is unreadable: ${error.message}`];
    throw error;
  }
  const found = [];
  if (limits.length !== 1) found.push(`the zones snippet holds ${limits.length} rate_limit blocks`);
  const global = named(limits[0]?.block ?? [], "zone").find((zone) => zone.args[0] === "global");
  if (global === undefined) found.push("there is no global zone");
  else if (named(global.block ?? [], "match").length > 0) found.push("the global zone has a matcher");
  return found;
}

function siteProblems(site: Site): string[] {
  const name = site.addresses.join(" ");
  const all = flatten(site.directives);
  const proxies = named(all, "reverse_proxy");
  if (proxies.length === 0) return loopbackOnly(site) ? [] : [`${name}: public site without rate limit`];
  const found = [];
  const routes = named(site.directives, "route");
  const route = routes.length === 1 && routes[0]?.args.length === 0 ? routes[0] : undefined;
  if (route === undefined) found.push(`${name}: not exactly one plain route`);
  const first = route?.block?.[0];
  if (first?.name !== "rate_limit" || first.via !== "pds-ratelimit") {
    found.push(`${name}: the route does not apply the zones first`);
  }
  if (named(flatten(route?.block ?? []), "reverse_proxy").length !== proxies.length) {
    found.push(`${name}: a reverse_proxy is outside the route`);
  }
  if (proxies.some((proxy) => upstreamOf(proxy) === null)) {
    found.push(`${name}: a reverse_proxy does not name one upstream in canonical form`);
  }
  const limits = named(all, "rate_limit").length;
  if (limits !== 1) found.push(`${name}: ${limits} rate_limit blocks`);
  for (const header of ADDRESS_HEADERS) {
    if (proxies.some((proxy) => passes(proxy, header))) found.push(`${name}: a reverse_proxy passes ${header}`);
  }
  return found;
}

/** An upstream in its one canonical form: a lower-case host name, no scheme or trailing dot, and a port with no leading
 * zero. Two sites naming one upstream then compare equal, whatever they would otherwise write. */
const CANONICAL_UPSTREAM = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*:([1-9]\d{0,4})$/;

/**
 * The one upstream `proxy` names, after an optional matcher token (`@name`, a path or `*`), or null when it names none,
 * several, or one in any other form (P1.28f; amendment 8, point 4: the comparison fails closed).
 */
function upstreamOf(proxy: Directive): string | null {
  const first = proxy.args[0] ?? "";
  const args = first.startsWith("@") || first.startsWith("/") || first === "*" ? proxy.args.slice(1) : proxy.args;
  const port = args.length === 1 ? CANONICAL_UPSTREAM.exec(args[0] as string)?.[1] : undefined;
  return port !== undefined && Number(port) <= 65535 ? (args[0] as string) : null;
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
