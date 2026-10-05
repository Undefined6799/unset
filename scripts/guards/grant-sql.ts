// P0.09e: reads migration SQL for the grant classifier (grant-parse.ts): a tokenizer that knows comments, quoted
// identifiers, strings and dollar quotes, the statements it splits into, and a cursor over one statement's tokens.
// Split from grant-parse.ts so each file holds one job: reading SQL here, deciding what it means there.

// ---- Tokenizer and statement splitting (rule 2) ----

type TokenType = "word" | "ident" | "string" | "dollar" | "punct" | "semi";
export type Token = { type: TokenType; text: string; start: number; end: number };
export type Statement = { tokens: Token[]; line: number; text: string; unterminated: boolean };
/** end -1 means the construct never closes. */
type Scan = { type: TokenType | "skip"; end: number };

const WORD_START = /[A-Za-z_\u0080-￿]/;
const WORD_REST = /[\w$\u0080-￿]*/y;
const NUMBER = /[0-9][\w.]*/y;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/y;

function stickyEnd(re: RegExp, src: string, at: number): number {
  re.lastIndex = at;
  return re.exec(src) === null ? at : re.lastIndex;
}

/** End of a quoted run starting at `at` (the quote); a doubled quote stays inside, as does `\x` in an E'' string. */
function quotedEnd(src: string, at: number, backslash: boolean): number {
  const quote = src[at];
  for (let j = at + 1; j < src.length; j++) {
    if (backslash && src[j] === "\\") j++;
    else if (src[j] === quote && src[j + 1] === quote) j++;
    else if (src[j] === quote) return j + 1;
  }
  return -1;
}

/** Postgres block comments nest. */
function blockCommentEnd(src: string, at: number): number {
  let depth = 0;
  for (let j = at; j < src.length - 1; j++) {
    const pair = src.slice(j, j + 2);
    if (pair === "/*") depth++;
    else if (pair === "*/") depth--;
    if (pair === "/*" || pair === "*/") j++;
    if (depth === 0) return j + 1;
  }
  return -1;
}

function dollarScan(src: string, at: number): Scan {
  DOLLAR_TAG.lastIndex = at;
  const tag = DOLLAR_TAG.exec(src)?.[0];
  if (tag === undefined) return { type: "punct", end: at + 1 }; // a $1 parameter
  const close = src.indexOf(tag, at + tag.length);
  return { type: "dollar", end: close < 0 ? -1 : close + tag.length };
}

/** Whitespace and comments, or null when the text at `at` is neither. */
function scanSkip(src: string, at: number): Scan | null {
  const pair = src.slice(at, at + 2);
  if (/[ \t\n\r]/.test(src[at] ?? "")) return { type: "skip", end: at + 1 };
  // Postgres ends a `--` comment at CR or LF.
  if (pair === "--") {
    const eol = /[\r\n]/.exec(src.slice(at));
    return { type: "skip", end: eol === null ? src.length : at + eol.index };
  }
  return pair === "/*" ? { type: "skip", end: blockCommentEnd(src, at) } : null;
}

function scanToken(src: string, at: number): Scan {
  const c = src[at] ?? "";
  const next = src[at + 1];
  const skip = scanSkip(src, at);
  if (skip !== null) return skip;
  if (c === "'") return { type: "string", end: quotedEnd(src, at, false) };
  if ((c === "e" || c === "E") && next === "'") return { type: "string", end: quotedEnd(src, at + 1, true) };
  if (c === '"') return { type: "ident", end: quotedEnd(src, at, false) };
  if (c === "$") return dollarScan(src, at);
  if (c === ";") return { type: "semi", end: at + 1 };
  if (WORD_START.test(c)) return { type: "word", end: stickyEnd(WORD_REST, src, at + 1) };
  if (/[0-9]/.test(c)) return { type: "punct", end: stickyEnd(NUMBER, src, at) };
  return { type: "punct", end: at + 1 };
}

/** Unquoted names fold ASCII letters only, as Postgres does; quoted names keep case with `""` undoubled. */
function tokenText(type: TokenType, raw: string): string {
  if (type === "word") return raw.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  if (type === "ident") return raw.slice(1, -1).replaceAll('""', '"');
  return raw;
}

function tokenize(src: string): { tokens: Token[]; unterminatedAt: number | null } {
  const tokens: Token[] = [];
  for (let at = 0; at < src.length; ) {
    const { type, end } = scanToken(src, at);
    if (end < 0) return { tokens, unterminatedAt: at };
    if (type !== "skip") tokens.push({ type, text: tokenText(type, src.slice(at, end)), start: at, end });
    at = end;
  }
  return { tokens, unterminatedAt: null };
}

/** Offset of the first character this tokenizer does not read as Postgres does, or -1. Only printable ASCII, tab,
 * LF and CRLF are read: Postgres treats other bytes (a lone CR, U+00A0) differently from JavaScript's `\s`, and a
 * `U&` escape can spell any name. A file with one is `unclassified` as a whole (fail closed). */
export function unreadableAt(src: string): number {
  return src.search(/[^\t\n\x20-\x7e\r]|\r(?!\n)|[uU]&["']/);
}

export const lineAt = (src: string, offset: number): number => src.slice(0, offset).split("\n").length;

function toStatement(src: string, tokens: Token[], unterminatedAt: number | null): Statement {
  const start = tokens[0]?.start ?? unterminatedAt ?? 0;
  const end = unterminatedAt === null ? (tokens.at(-1)?.end ?? start) : src.length;
  return {
    tokens,
    line: lineAt(src, start),
    text: src.slice(start, end).trim(),
    unterminated: unterminatedAt !== null,
  };
}

export function splitStatements(src: string): Statement[] {
  const { tokens, unterminatedAt } = tokenize(src);
  const statements: Statement[] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.type !== "semi") current.push(token);
    else if (current.length > 0) statements.push(toStatement(src, current, null));
    if (token.type === "semi") current = [];
  }
  if (unterminatedAt !== null || current.length > 0) statements.push(toStatement(src, current, unterminatedAt));
  return statements;
}

// ---- Reading a statement ----

export type QName = { schema: string; name: string };
const SEP = "\u0000"; // cannot occur in a Postgres identifier, so keys never collide
export const key = (kind: "rel" | "fn", q: QName): string => [kind, q.schema, q.name].join(SEP);
export const colKey = (q: QName, column: string): string => ["col", q.schema, q.name, column].join(SEP);

export class Cursor {
  readonly tokens: readonly Token[];
  #pos = 0;
  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }
  get done(): boolean {
    return this.#pos >= this.tokens.length;
  }
  isWord(...words: string[]): boolean {
    return words.every((w, k) => this.tokens[this.#pos + k]?.type === "word" && this.tokens[this.#pos + k]?.text === w);
  }
  accept(...words: string[]): boolean {
    if (!this.isWord(...words)) return false;
    this.#pos += words.length;
    return true;
  }
  acceptPunct(p: string): boolean {
    const t = this.tokens[this.#pos];
    if (t?.type !== "punct" || t.text !== p) return false;
    this.#pos++;
    return true;
  }
  ident(): string | null {
    const t = this.tokens[this.#pos];
    if (t === undefined || (t.type !== "word" && t.type !== "ident")) return null;
    this.#pos++;
    return t.text;
  }
  /** A schema-qualified name. An unqualified one is null: it resolves through search_path, which this parser cannot
   * know, so whatever depends on it fails closed. */
  name(): QName | null {
    const parts: string[] = [];
    for (let part = this.ident(); part !== null; part = this.acceptPunct(".") ? this.ident() : null) parts.push(part);
    const [schema, name] = parts.slice(-2);
    if (schema === undefined || name === undefined || parts.length > 3) return null;
    return { schema, name };
  }
  /** The tokens inside a parenthesised group at the cursor (and moves past it), or [] when there is none. */
  parens(): Token[] {
    if (!this.acceptPunct("(")) return [];
    const start = this.#pos;
    for (let depth = 1; this.#pos < this.tokens.length; this.#pos++) {
      depth += depthChange(this.tokens[this.#pos]);
      if (depth === 0) return this.tokens.slice(start, this.#pos++);
    }
    return this.tokens.slice(start);
  }
  rest(): Token[] {
    return this.tokens.slice(this.#pos);
  }
}

export function depthChange(t: Token | undefined): number {
  if (t?.type !== "punct") return 0;
  return t.text === "(" ? 1 : t.text === ")" ? -1 : 0;
}

/** Splits on commas outside parentheses. */
export function splitTopLevel(tokens: readonly Token[]): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    depth += depthChange(t);
    if (depth === 0 && t.type === "punct" && t.text === ",") parts.push([]);
    else parts.at(-1)?.push(t);
  }
  return parts.filter((p) => p.length > 0);
}

/** Index of the first of `words` outside parentheses, or -1. */
export function topLevelWord(tokens: readonly Token[], words: readonly string[]): number {
  let depth = 0;
  for (const [i, t] of tokens.entries()) {
    depth += depthChange(t);
    if (depth === 0 && t.type === "word" && words.includes(t.text)) return i;
  }
  return -1;
}

export const hasWords = (tokens: readonly Token[], ...words: string[]): boolean =>
  tokens.some((_, i) => new Cursor(tokens.slice(i)).isWord(...words));

// ---- Objects a migration creates (rule 1) ----

const TABLE_CONSTRAINTS = ["constraint", "primary", "unique", "check", "foreign", "exclude", "like"];
const SERIAL = /^(small|big)?serial[248]?$/;

function columnObjects(table: QName, columnDefs: Token[]): string[] {
  const keys: string[] = [];
  for (const item of splitTopLevel(columnDefs)) {
    const first = item[0];
    if (first === undefined || (first.type === "word" && TABLE_CONSTRAINTS.includes(first.text))) continue;
    keys.push(colKey(table, first.text));
    const sequenced = item.some((t) => t.type === "word" && (SERIAL.test(t.text) || t.text === "identity"));
    if (sequenced) keys.push(key("rel", { schema: table.schema, name: `${table.name}_${first.text}_seq` }));
  }
  return keys;
}

function addedColumns(c: Cursor): string[] {
  c.accept("if", "exists");
  c.accept("only");
  const table = c.name();
  if (table === null) return [];
  return splitTopLevel(c.rest()).flatMap((action) => {
    const a = new Cursor(action);
    if (!a.accept("add", "column")) return [];
    // IF NOT EXISTS may be a no-op on an object the parser did not see in the base, so it never counts as created.
    if (a.accept("if", "not", "exists")) return [];
    const column = a.ident();
    return column === null ? [] : [colKey(table, column)];
  });
}

function createdObjects(stmt: Statement): string[] {
  const c = new Cursor(stmt.tokens);
  if (stmt.unterminated) return [];
  if (c.accept("alter", "table")) return addedColumns(c);
  if (!c.accept("create")) return [];
  c.accept("or", "replace");
  const kind = c.accept("table") ? "table" : c.accept("function") || c.accept("procedure") ? "fn" : null;
  const relation = kind === null && (c.accept("view") || c.accept("materialized", "view") || c.accept("sequence"));
  if (kind === null && !relation) return [];
  if (c.accept("if", "not", "exists")) return [];
  const name = c.name();
  if (name === null) return [];
  if (kind === "fn") return [key("fn", name)];
  return kind === "table" ? [key("rel", name), ...columnObjects(name, c.parens())] : [key("rel", name)];
}

export const objectsOf = (statements: Statement[]): Set<string> => new Set(statements.flatMap(createdObjects));
