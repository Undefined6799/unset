// The one reader of the edge's Caddyfile for checks (P1.28h; architecture record
// 2026-10-07-p130s-networks-and-caddyfile-reader, point 2): edge.test.ts and, from P1.30u, the deploy preflight's C18
// read the config through it, so CI and the deploy gate cannot disagree about which routes carry the zones.
//
// It tokenises the way Caddy v2.11.7 does (caddyconfig/caddyfile/lexer.go: whitespace-separated words, "double" and
// `backtick` quotes, `#` comments at the start of a word, newlines ending a directive, `{` and `}` as block tokens) and
// builds sites, blocks and directives (parse.go). Environment placeholders `{$NAME}` are replaced from the given map
// before lexing, as Caddy does (parse.go replaceEnvVars). `import` expands only a snippet `(name) { … }` defined earlier
// in the same text, with `{args[N]}` replaced (importer.go). Anything else this reader does not model fails rather than
// being skipped: a file or glob import, a heredoc, an env default (`{$NAME:x}`), an unknown env name, `{block}` or any
// other `{args…}` form, an unbalanced brace, a top-level line that is not a site, snippet or global options block.

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

type Token = { text: string; quoted: boolean; line: number };
type Line = { tokens: Token[]; via: string | null };

const ENV = /\{\$([^}]*)\}/g;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** At most this many snippet expansions in one read: a snippet that imports itself fails instead of looping. */
const MAX_IMPORTS = 1000;

export function readCaddyfile(text: string, env: Readonly<Record<string, string>>): Caddyfile {
  const lines = lex(substituteEnv(text, env));
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
      [global, at] = readBlock(lines, at + 1, expander);
      continue;
    }
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
    const addresses = line.tokens.slice(0, -1).map((token) => word(token));
    let directives: Directive[];
    [directives, at] = readBlock(lines, at + 1, expander);
    sites.push({ addresses, directives });
  }
  const snippet = (name: string, args: readonly string[] = []): Directive[] => {
    const body = snippets.get(name);
    if (body === undefined) throw new CaddyfileError(`no snippet ${name}`);
    const copy = body.map((line) => ({ via: line.via, tokens: line.tokens.map((t) => withArgs(t, args)) }));
    copy.push({ via: null, tokens: [{ text: "}", quoted: false, line: 0 }] });
    return readBlock(copy, 0, expander)[0];
  };
  return { global, sites, snippet };
}

function fail(line: number, why: string): never {
  throw new CaddyfileError(`line ${line}: ${why}`);
}

/** `{$NAME}` from `env`; a missing name, a default (`{$NAME:x}`) or any other form fails. */
function substituteEnv(text: string, env: Readonly<Record<string, string>>): string {
  return text.replaceAll(ENV, (_, name: string) => {
    if (!ENV_NAME.test(name)) throw new CaddyfileError(`unsupported environment placeholder {$${name}}`);
    const value = env[name];
    if (value === undefined) throw new CaddyfileError(`environment placeholder {$${name}} has no value`);
    return value;
  });
}

/** One lexeme: a newline, other whitespace, a comment, a "double" (with \" escapes) or `backtick` quoted word, or a word. */
const LEXEME = /(\n)|[^\S\n]+|#[^\n]*|"((?:\\"|[^"])*)"|`([^`]*)`|(\S+)/gy;

/** Lines of tokens; blank and comment-only lines dropped. */
function lex(text: string): Line[] {
  const lines: Line[] = [];
  let tokens: Token[] = [];
  let line = 1;
  for (const [whole, newline, double, backtick, bareWord] of text.matchAll(LEXEME)) {
    if (newline !== undefined && tokens.length > 0) {
      lines.push({ tokens, via: null });
      tokens = [];
    }
    if (double !== undefined) tokens.push({ text: double.replaceAll('\\"', '"'), quoted: true, line });
    if (backtick !== undefined) tokens.push({ text: backtick, quoted: true, line });
    if (bareWord !== undefined) tokens.push(bare(bareWord, line));
    line += whole.split("\n").length - 1;
  }
  if (tokens.length > 0) lines.push({ tokens, via: null });
  return lines;
}

/** An unquoted word, refused when it is a heredoc or a placeholder form this reader does not model. */
function bare(text: string, line: number): Token {
  if (/^["`]/.test(text)) fail(line, "unterminated quote");
  if (text.startsWith("<<")) fail(line, "heredoc not supported");
  if (/\{\$|\{block|\{blocks\./.test(text)) fail(line, `unsupported placeholder in ${text}`);
  return { text, quoted: false, line };
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
function readBlock(lines: Line[], start: number, expander: Expander): [Directive[], number] {
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
    if (opens) [directive.block, at] = readBlock(lines, at + 1, expander);
    else at += 1;
    directives.push(directive);
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
