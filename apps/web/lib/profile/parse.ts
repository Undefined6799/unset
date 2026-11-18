// The README card's text (ADR 0051): a small CommonMark subset (https://spec.commonmark.org/0.31.2/) parsed into
// blocks that a renderer writes as escaped elements (readme.svelte), so member text is always escaped and raw HTML
// is shown as text, never parsed. Blocks: ATX headings, paragraphs, bullet and ordered lists, block quotes, fenced
// code and thematic breaks; a list item's own list, indented to the item's text, nests up to MAX_LIST_DEPTH. Inline:
// code spans, strong, emphasis, links and autolinks. Images are not shown (there is no media proxy), so `![alt](url)`
// is a link to the image with its alt text. A link is kept only when safeHref accepts it as http or https
// (shared/ui/safe-href.ts); otherwise its characters stay text. Nothing here throws: any input renders.
import { type SafeHref, safeHref } from "@unset/shared-safe-href";
import {
  codeCloser,
  destinationFinder,
  emphasisCloser,
  isWord,
  type Mark,
  nextIndex,
  runLength,
  unescapeDestination,
} from "./readme-scan.ts";

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong" | "em"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: SafeHref; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly kind: "paragraph" | "quote"; readonly children: readonly Inline[] }
  | ListBlock
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" };

export type ListBlock = {
  readonly kind: "list";
  readonly ordered: boolean;
  /** An ordered list's first number, when it is not 1. */
  readonly start?: number;
  readonly items: readonly ListItem[];
};
/** A list item's text, and the lists indented under it. */
export type ListItem = { readonly text: readonly Inline[]; readonly lists: readonly ListBlock[] };

/** Guards, not limits: the lexicon caps the text at 100,000 bytes. */
const MAX_CHARS = 100_000;
const MAX_BLOCKS = 2_000;
const MAX_DEPTH = 3;
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

/** Left to right; anything that does not open a construct is text. Nested constructs stop at MAX_DEPTH. */
export function parseInline(text: string, depth = 0, links = true): Inline[] {
  const out: Inline[] = [];
  const find: Finders = {
    labelClose: nextIndex(text, "]("),
    destination: destinationFinder(text),
    bracket: nextIndex(text, "["),
    codeClose: codeCloser(text),
    emphasisClose: emphasisCloser(text),
  };
  let buffer = "";
  for (let i = 0; i < text.length; ) {
    const taken =
      depth >= MAX_DEPTH
        ? null
        : (takeCode(text, i, find) ??
          (links
            ? (takeAutolink(text, i) ?? takeImage(text, i, depth, find) ?? takeLink(text, i, depth, find))
            : null) ??
          takeEmphasis(text, i, depth, links, find));
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
function run(lines: readonly string[], at: number, pattern: RegExp): { items: string[]; next: number } {
  const items: string[] = [];
  let i = at;
  for (let match = pattern.exec(lines[i] ?? ""); match !== null; match = pattern.exec(lines[i] ?? "")) {
    items.push((match[1] ?? "").trim());
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
    items.push({ text: parseInline(item.text), lists });
    at = end;
  }
  const start = first?.start ?? 1;
  const list: ListBlock = { kind: "list", ordered, items };
  return { block: start === 1 ? list : { ...list, start }, next: at };
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
  if (QUOTE.test(line)) {
    const { items, next } = run(lines, i, QUOTE);
    return { block: { kind: "quote", children: parseInline(items.join(" ")) }, next };
  }
  let next = i + 1;
  while (next < lines.length && !startsBlock(lines[next] ?? "")) next += 1;
  const text = lines
    .slice(i, next)
    .map((l) => l.trim())
    .join(" ");
  return { block: { kind: "paragraph", children: parseInline(text) }, next };
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
