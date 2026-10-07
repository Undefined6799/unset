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
//   (importer.go). File and glob imports, named routes (`&(name)`, `invoke`) and quoted directive names fail.
// - Directives come from an allowlist per block (DIRECTIVES): what our files use today, nothing more. Adding one is a
//   trusted change in the same PR as the Caddyfile line that needs it.

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

/** At most this many snippet expansions in one read: a snippet that imports itself fails instead of looping. */
const MAX_IMPORTS = 1000;

export function readCaddyfile(text: string, env: Env): Caddyfile {
  const lines = lex(text).map((line) => ({ ...line, tokens: line.tokens.map((token) => withEnv(token, env)) }));
  const snippets = new Map<string, Line[]>();
  const expander = { snippets, imports: 0 };
  const sites: Site[] = [];
  let global: Directive[] | null = null;
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] as Line;
    const [first, ...rest] = line.tokens as [Token, ...Token[]];
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
