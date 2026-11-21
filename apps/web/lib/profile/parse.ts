// The README card's text (ADR 0051): a small CommonMark subset (https://spec.commonmark.org/0.31.2/) parsed into
// blocks that a renderer writes as escaped elements (readme.svelte), so member text is always escaped and raw HTML
// is shown as text, never parsed. Blocks: ATX headings, paragraphs, bullet and ordered lists, block quotes, fenced
// code and thematic breaks; a list item's own list, indented to the item's text, nests up to MAX_LIST_DEPTH. Inline:
// code spans, strong, emphasis, links and autolinks, backslash escapes and numeric character references. From GitHub
// Flavored Markdown 0.29 (https://github.github.com/gfm/, read as cmark-gfm test/spec.txt), as ADR 0086 lets readers
// extend CommonMark: strikethrough, task list items and tables. Images are
// not shown (there is no media proxy), so `![alt](url)` is a link to the image with its alt text. A link is kept
// only when safeHref accepts it as http or https (shared/ui/safe-href.ts); otherwise its characters stay text.
// Nothing here throws: any input renders.
import { type SafeHref, safeHref } from "@unset/shared-safe-href";
import {
  codeCloser,
  destinationFinder,
  emphasisCloser,
  isEscapable,
  isWord,
  type Mark,
  nextUnescaped,
  runLength,
  unescapeDestination,
} from "./readme-scan.ts";

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "break" }
  | { readonly kind: "strong" | "em" | "del"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: SafeHref; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly kind: "paragraph"; readonly children: readonly Inline[] }
  | { readonly kind: "quote"; readonly paragraphs: readonly (readonly Inline[])[] }
  | ListBlock
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" }
  | TableBlock;

/** A table's column alignments, header cells and data rows, each row as wide as the header (GFM "Tables"). */
export type TableBlock = {
  readonly kind: "table";
  readonly align: readonly ("left" | "center" | "right" | null)[];
  readonly head: readonly (readonly Inline[])[];
  readonly rows: readonly (readonly (readonly Inline[])[])[];
};

export type ListBlock = {
  readonly kind: "list";
  readonly ordered: boolean;
  /** An ordered list's first number, when it is not 1. */
  readonly start?: number;
  readonly items: readonly ListItem[];
};
/** A list item's text, the lists indented under it, and whether it is a task and ticked (GFM "Task list items"). */
export type ListItem = {
  readonly text: readonly Inline[];
  readonly lists: readonly ListBlock[];
  readonly task?: "open" | "done";
};

/** Guards, not limits: the lexicon caps the text at 100,000 bytes. */
const MAX_CHARS = 100_000;
const MAX_BLOCKS = 2_000;
const MAX_DEPTH = 3;
/** A guard: a table wider than this is read as text. */
const MAX_COLUMNS = 50;
/** Lists nest this deep; an item indented further is a sibling of the deepest. */
const MAX_LIST_DEPTH = 3;

const WEB = ["http:", "https:"] as const;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** Only the opening marks: the rest of the line is scanned, so no member-written line can make the match backtrack. */
const HEADING_START = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
/** Any list item line at any indent: its indent, its marker, the spaces after it and its text. */
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Removes C0 controls except tab and line feed, and DEL; CRLF and CR become LF. */
function clean(src: string): string {
  return src
    .slice(0, MAX_CHARS)
    .replace(/\r\n?/g, "\n")
    .split("")
    .filter((ch) => ch === "\n" || ch === "\t" || (ch > "\u001f" && ch !== "\u007f"))
    .join("");
}

// ---- Inline ------------------------------------------------------------------------------------------------------

type Taken = { readonly node: Inline; readonly next: number };

/**
 * A code span: a backtick run closed by a run of the same length, so `` `x` `` shows its backticks; one space is
 * stripped from each end when both are there (CommonMark 0.31.2, "Code spans"). A run that never closes is text.
 */
function takeCode(text: string, i: number, find: Finders): Taken | null {
  if (text[i] !== "`") return null;
  const length = runLength(text, i, "`");
  const end = find.codeClose(length, i + length);
  if (end === -1) return { node: { kind: "text", text: "`".repeat(length) }, next: i + length };
  const raw = text.slice(i + length, end);
  const padded = raw.length > 1 && raw.startsWith(" ") && raw.endsWith(" ") && raw.trim() !== "";
  return { node: { kind: "code", text: padded ? raw.slice(1, -1) : raw }, next: end + length };
}

function takeAutolink(text: string, i: number): Taken | null {
  const match = text[i] === "<" ? /^<(https?:\/\/[^\s<>]+)>/i.exec(text.slice(i)) : null;
  const href = match?.[1] === undefined ? null : safeHref(match[1], WEB);
  if (match === null || href === null) return null;
  return { node: { kind: "link", href, children: [{ kind: "text", text: href }] }, next: i + match[0].length };
}

type Finders = {
  readonly labelClose: (from: number) => number;
  readonly destination: (from: number) => number;
  readonly bracket: (from: number) => number;
  readonly codeClose: (length: number, from: number) => number;
  readonly emphasisClose: (mark: Mark, from: number) => number;
};

function takeLink(text: string, i: number, depth: number, find: Finders): Taken | null {
  if (text[i] !== "[") return null;
  const labelEnd = find.labelClose(i + 1);
  if (labelEnd === -1) return null;
  const inner = find.bracket(i + 1);
  if (inner !== -1 && inner < labelEnd) return null;
  const urlEnd = find.destination(labelEnd + 2);
  const url = urlEnd === -1 ? "" : unescapeDestination(text.slice(labelEnd + 2, urlEnd));
  const href = url === "" ? null : safeHref(url, WEB);
  if (href === null) return null;
  const children = parseInline(text.slice(i + 1, labelEnd), depth + 1, false);
  return { node: { kind: "link", href, children }, next: urlEnd + 1 };
}

/**
 * An image, `![alt](url)`: not shown, since there is no media proxy, so it is a link to the image with the alt text,
 * and without the "!". One whose address safeHref refuses stays text, as a link does.
 */
function takeImage(text: string, i: number, depth: number, find: Finders): Taken | null {
  return text[i] === "!" && text[i + 1] === "[" ? takeLink(text, i + 1, depth, find) : null;
}

/** Strikethrough, `~~words~~` (GFM 0.29, "Strikethrough (extension)"): paired as emphasis is; a single tilde is text. */
function takeStrike(text: string, i: number, depth: number, links: boolean, find: Finders): Taken | null {
  if (!text.startsWith("~~", i)) return null;
  const end = find.emphasisClose("~~", i + 2);
  if (end <= i + 2) return null;
  return { node: { kind: "del", children: parseInline(text.slice(i + 2, end), depth + 1, links) }, next: end + 2 };
}

function takeEmphasis(text: string, i: number, depth: number, links: boolean, find: Finders): Taken | null {
  const strong = text.startsWith("**", i) || text.startsWith("__", i);
  const ch = text[i];
  if (ch !== "*" && ch !== "_") return null;
  if (ch === "_" && isWord(text[i - 1])) return null;
  const mark: Mark = strong ? (ch === "*" ? "**" : "__") : ch;
  const from = i + mark.length;
  const end = find.emphasisClose(mark, from);
  if (end <= from) return null;
  const children = parseInline(text.slice(from, end), depth + 1, links);
  return { node: { kind: strong ? "strong" : "em", children }, next: end + mark.length };
}

const REFERENCE = /^&#(?:[xX]([0-9a-fA-F]{1,6})|([0-9]{1,7}));/;

/**
 * A numeric character reference, `&#123;` or `&#x7b;`, is its character as text (CommonMark 0.31.2, "Entity and numeric
 * character references"); remark writes the letters beside an italic inside a word this way. Code point 0, a
 * surrogate or one past U+10FFFF is U+FFFD. Named entities stay text. The renderer escapes the character as any text.
 */
function numericReference(text: string, i: number): { char: string; next: number } | null {
  const match = REFERENCE.exec(text.slice(i, i + 12));
  if (match === null) return null;
  const code = match[1] === undefined ? Number(match[2]) : Number.parseInt(match[1], 16);
  const valid = code !== 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
  return { char: valid ? String.fromCodePoint(code) : "\uFFFD", next: i + match[0].length };
}

/** Left to right; anything that does not open a construct is text. Nested constructs stop at MAX_DEPTH. */
export function parseInline(text: string, depth = 0, links = true): Inline[] {
  const out: Inline[] = [];
  const find: Finders = {
    labelClose: nextUnescaped(text, "]("),
    destination: destinationFinder(text),
    bracket: nextUnescaped(text, "["),
    codeClose: codeCloser(text),
    emphasisClose: emphasisCloser(text),
  };
  let buffer = "";
  for (let i = 0; i < text.length; ) {
    // A backslash escape (CommonMark 0.31.2, "Backslash escapes") is its character as text, before any construct.
    if (text[i] === "\\" && isEscapable(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    const reference = text[i] === "&" ? numericReference(text, i) : null;
    if (reference !== null) {
      buffer += reference.char;
      i = reference.next;
      continue;
    }
    const taken =
      depth >= MAX_DEPTH
        ? null
        : (takeCode(text, i, find) ??
          (links
            ? (takeAutolink(text, i) ?? takeImage(text, i, depth, find) ?? takeLink(text, i, depth, find))
            : null) ??
          takeEmphasis(text, i, depth, links, find) ??
          takeStrike(text, i, depth, links, find));
    if (taken === null) {
      buffer += text[i];
      i += 1;
      continue;
    }
    if (taken.node.kind === "text") {
      buffer += taken.node.text;
      i = taken.next;
      continue;
    }
    if (buffer !== "") out.push({ kind: "text", text: buffer });
    buffer = "";
    out.push(taken.node);
    i = taken.next;
  }
  if (buffer !== "") out.push({ kind: "text", text: buffer });
  return out;
}

// ---- Blocks ------------------------------------------------------------------------------------------------------

const startsBlock = (line: string) =>
  line.trim() === "" ||
  FENCE.test(line) ||
  HEADING_START.test(line) ||
  RULE.test(line) ||
  BULLET.test(line) ||
  ORDERED.test(line) ||
  QUOTE.test(line);

/** Consecutive lines matching `pattern`, each reduced to its first group; returns the lines and the next index. */
function run(lines: readonly string[], at: number, pattern: RegExp, trim = true): { items: string[]; next: number } {
  const items: string[] = [];
  let i = at;
  for (let match = pattern.exec(lines[i] ?? ""); match !== null; match = pattern.exec(lines[i] ?? "")) {
    // A quote keeps each line's end as written: two trailing spaces break the line there.
    items.push(trim ? (match[1] ?? "").trim() : (match[1] ?? "").trimStart());
    i += 1;
  }
  return { items, next: i };
}

/**
 * A closing fence: only the opening fence's character, at least as many times, and spaces (CommonMark 0.31.2,
 * "Fenced code blocks"), so a longer fence can show a shorter one.
 */
function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && [...trimmed].every((ch) => ch === fence[0]);
}

/** A fenced code block; an unclosed fence runs to the end of the text, as CommonMark says. */
function takeFence(lines: readonly string[], i: number, fence: string): { block: Block; next: number } {
  let end = i + 1;
  while (end < lines.length && !closesFence(lines[end] ?? "", fence)) end += 1;
  return { block: { kind: "code", text: lines.slice(i + 1, end).join("\n") }, next: end + 1 };
}

/**
 * A heading's text without its optional closing hashes, which count only after a space or tab (CommonMark 0.31.2,
 * "ATX headings"): "## C#" keeps its hash. One pass from the end, so linear in the line.
 */
function headingText(rest: string): string {
  const text = rest.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === text.length) return text;
  if (end === 0) return "";
  const before = text[end - 1];
  return before === " " || before === "\t" ? text.slice(0, end).trim() : text;
}

/** Columns of leading space, a tab counting as four (CommonMark 0.31.2, "Tabs", simplified). */
const columns = (space: string) => [...space].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);

type ItemLine = {
  readonly indent: number;
  readonly content: number;
  readonly ordered: boolean;
  readonly start: number;
  readonly text: string;
};

function itemLine(line: string): ItemLine | null {
  const match = ITEM.exec(line);
  if (match === null) return null;
  const [, space = "", mark = "", gap = "", text = ""] = match;
  const indent = columns(space);
  const ordered = !"-*+".includes(mark);
  return {
    indent,
    content: indent + mark.length + columns(gap),
    ordered,
    start: ordered ? Number(mark.slice(0, -1)) : 1,
    text: text.trim(),
  };
}

/** Removes `width` columns of leading space, or all of it when there is less. */
function dedent(line: string, width: number): string {
  let i = 0;
  for (let taken = 0; i < line.length && taken < width && (line[i] === " " || line[i] === "\t"); i += 1) {
    taken += line[i] === "\t" ? 4 : 1;
  }
  return line.slice(i);
}

/**
 * A bullet or ordered list from its first item line; an ordered list keeps its first number when it is not 1
 * (CommonMark 0.31.2, "Lists"). The item lines after an item that are indented at least to its text are its own
 * lists, read the same way with that indent removed; past MAX_LIST_DEPTH they are siblings instead. A line that is no
 * item, or an item of the other kind, ends the list. Each line is read once per level, so the parse stays linear.
 */
function takeList(lines: readonly string[], i: number, depth = 1): { block: ListBlock; next: number } {
  const first = itemLine(lines[i] ?? "");
  const ordered = first?.ordered ?? false;
  const items: ListItem[] = [];
  let at = i;
  for (let item = first; item !== null && item.ordered === ordered; item = itemLine(lines[at] ?? "")) {
    at += 1;
    const nested = depth < MAX_LIST_DEPTH ? item.content : Number.POSITIVE_INFINITY;
    let end = at;
    while (end < lines.length && (itemLine(lines[end] ?? "")?.indent ?? -1) >= nested) end += 1;
    const inner = lines.slice(at, end).map((line) => dedent(line, item.content));
    const lists: ListBlock[] = [];
    for (let j = 0; j < inner.length; ) {
      const sub = takeList(inner, j, depth + 1);
      lists.push(sub.block);
      j = Math.max(sub.next, j + 1);
    }
    items.push(listItem(item.text, lists));
    at = end;
  }
  const start = first?.start ?? 1;
  const list: ListBlock = { kind: "list", ordered, items };
  return { block: start === 1 ? list : { ...list, start }, next: at };
}

/**
 * A task list item opens with `[ ]`, `[x]` or `[X]` and a space before its words (GFM 0.29, "Task list items
 * (extension)"); the marker is not shown as text.
 */
const TASK = /^\[([ xX])\][ \t]+(\S.*)$/;

function listItem(text: string, lists: readonly ListBlock[]): ListItem {
  const task = TASK.exec(text);
  if (task === null) return { text: parseInline(text), lists };
  return { text: parseInline(task[2] ?? ""), lists, task: task[1] === " " ? "open" : "done" };
}

/**
 * A row's cells: split at each pipe that is not escaped, without the optional pipe at each end; an escaped pipe is a
 * pipe in its cell, inside a code span too (GFM 0.29, "Tables (extension)"). One pass over the line.
 */
function rowCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (line[i] === "|") {
      cells.push(cell);
      cell = "";
    } else cell += line[i];
  }
  cells.push(cell);
  const trimmed = line.trim();
  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|") && cells.length > 0) cells.pop();
  return cells.map((c) => c.trim());
}

const DELIMITER_CELL = /^(:?)-+(:?)$/;

/** The alignments of a delimiter row, or null when the line is none: only hyphens with an optional colon each end. */
function delimiterRow(line: string): TableBlock["align"] | null {
  if (!line.includes("-")) return null;
  const cells = rowCells(line);
  const align: ("left" | "center" | "right" | null)[] = [];
  for (const cell of cells) {
    const match = DELIMITER_CELL.exec(cell);
    if (match === null) return null;
    const [, left, right] = match;
    align.push(left !== "" && right !== "" ? "center" : right !== "" ? "right" : left !== "" ? "left" : null);
  }
  return align;
}

/**
 * A table from a header row whose next line is a delimiter row with as many cells. It starts only where a block may
 * (not inside a paragraph), and its rows run to a blank line or the start of another block; each row is filled with
 * empty cells or cut to the header's width.
 */
function takeTable(lines: readonly string[], i: number): { block: Block; next: number } | null {
  const header = lines[i] ?? "";
  if (!header.includes("|")) return null;
  const align = delimiterRow(lines[i + 1] ?? "");
  const head = rowCells(header);
  if (align === null || align.length !== head.length || head.length > MAX_COLUMNS) return null;
  const rows: Inline[][][] = [];
  let next = i + 2;
  for (; next < lines.length && !startsBlock(lines[next] ?? ""); next += 1) {
    const cells = rowCells(lines[next] ?? "");
    rows.push(head.map((_, c) => parseInline(cells[c] ?? "")));
  }
  return { block: { kind: "table", align, head: head.map((cell) => parseInline(cell)), rows }, next };
}

function takeBlock(lines: readonly string[], i: number): { block: Block | null; next: number } {
  const line = lines[i] ?? "";
  if (line.trim() === "") return { block: null, next: i + 1 };
  const fence = FENCE.exec(line)?.[1];
  if (fence !== undefined) return takeFence(lines, i, fence);
  const heading = HEADING_START.exec(line);
  if (heading !== null) {
    const level = Math.min((heading[1] ?? "#").length, 3) as 1 | 2 | 3;
    const text = headingText(line.slice(heading[0].length));
    return { block: { kind: "heading", level, children: text === "" ? [] : parseInline(text) }, next: i + 1 };
  }
  if (RULE.test(line)) return { block: { kind: "rule" }, next: i + 1 };
  if (BULLET.test(line) || ORDERED.test(line)) return takeList(lines, i);
  if (QUOTE.test(line)) return takeQuote(lines, i);
  return takeTable(lines, i) ?? takeParagraph(lines, i);
}

function takeQuote(lines: readonly string[], i: number): { block: Block | null; next: number } {
  const { items, next } = run(lines, i, QUOTE, false);
  const paragraphs = quoteParagraphs(items);
  return { block: paragraphs.length === 0 ? null : { kind: "quote", paragraphs }, next };
}

function takeParagraph(lines: readonly string[], i: number): { block: Block | null; next: number } {
  let next = i + 1;
  while (next < lines.length && !startsBlock(lines[next] ?? "")) next += 1;
  const text = lines.slice(i, next);
  if (isEmptyLineMark(text)) return { block: null, next };
  return { block: { kind: "paragraph", children: paragraphInline(text) }, next };
}

/**
 * A paragraph's lines: a line that ends in a backslash or two spaces is a hard line break (CommonMark 0.31.2 §6.7),
 * which the in-place editor writes for Shift+Enter; any other line end is a space (§6.8).
 */
function paragraphInline(lines: readonly string[]): Inline[] {
  const out: Inline[] = [];
  let words: string[] = [];
  lines.forEach((raw, at) => {
    const last = at === lines.length - 1;
    const hard = !last && (/\\$/.test(raw) || / {2,}$/.test(raw));
    words.push(hard ? raw.trim().replace(/\\$/, "").trimEnd() : raw.trim());
    if (!hard) return;
    out.push(...parseInline(words.join(" ")), { kind: "break" });
    words = [];
  });
  out.push(...parseInline(words.join(" ")));
  return out;
}

/** A quote's lines without their markers: paragraphs split at its blank lines, empty-line marks dropped. */
function quoteParagraphs(items: readonly string[]): Inline[][] {
  const paragraphs: Inline[][] = [];
  let lines: string[] = [];
  const close = () => {
    if (lines.length > 0 && !isEmptyLineMark(lines)) paragraphs.push(paragraphInline(lines));
    lines = [];
  };
  for (const item of items) {
    if (item.trim() === "") close();
    else lines.push(item);
  }
  close();
  return paragraphs;
}

/**
 * The paragraph Milkdown's preset-commonmark 7.23.0 wrote for an empty line before P1.21s (paragraph.ts
 * EMPTY_LINE_PLACEHOLDER, "<br />"): stored cards may hold it, and it shows nothing.
 */
function isEmptyLineMark(lines: readonly string[]): boolean {
  return lines.length === 1 && /^\s*<br\s*\/?>\s*$/i.test(lines[0] ?? "");
}

export function parseReadme(src: string): Block[] {
  const lines = clean(src).split("\n");
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length && blocks.length < MAX_BLOCKS; ) {
    const { block, next } = takeBlock(lines, i);
    if (block !== null) blocks.push(block);
    i = next;
  }
  return blocks;
}
