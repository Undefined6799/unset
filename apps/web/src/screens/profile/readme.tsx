// The README card's text (ADR 0051): a small CommonMark subset (https://spec.commonmark.org/0.31.2/) parsed into
// blocks that React renders, so member text is always escaped and raw HTML is shown as text, never parsed. Blocks:
// ATX headings, paragraphs, bullet and ordered lists, block quotes, fenced code and thematic breaks. Inline: code
// spans, strong, emphasis, links and autolinks. A link is kept only when safeHref accepts it as http or https
// (shared/ui/safe-href.ts); otherwise its characters stay text. Nothing here throws: any input renders.
import { type SafeHref, safeHref } from "@unset/shared-ui";
import { Children, type ReactNode } from "react";

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong" | "em"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: SafeHref; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly kind: "paragraph" | "quote"; readonly children: readonly Inline[] }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" };

/** Guards, not limits: the lexicon caps the text at 100,000 bytes. */
const MAX_CHARS = 100_000;
const MAX_BLOCKS = 2_000;
const MAX_DEPTH = 3;

const WEB = ["http:", "https:"] as const;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** Only the opening marks: the rest of the line is scanned, so no member-written line can make the match backtrack. */
const HEADING_START = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
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
const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** The length of the run of `ch` starting at `i`. */
function runLength(text: string, i: number, ch: string): number {
  let j = i;
  while (text[j] === ch) j += 1;
  return j - i;
}

/**
 * Where the next run of exactly `length` backticks starts, at or after a position; -1 when none does. Remembered per
 * length, as parseInline only moves forward, so a run that never closes is searched for once, not once per opener.
 */
function codeCloser(text: string): (length: number, from: number) => number {
  const memo = new Map<number, { searched: number; found: number }>();
  return (length, from) => {
    const seen = memo.get(length);
    if (seen !== undefined && from >= seen.searched && (seen.found === -1 || seen.found >= from)) return seen.found;
    const ticks = "`".repeat(length);
    let found = text.indexOf(ticks, from);
    while (found !== -1) {
      const run = runLength(text, found, "`");
      if (run === length && text[found - 1] !== "`") break;
      found = text.indexOf(ticks, found + run);
    }
    memo.set(length, { searched: from, found });
    return found;
  };
}

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

/** The longest link destination scanned: the lexicon's 2,000-byte address limit. */
const MAX_DESTINATION = 2_000;

/**
 * Where a link destination ends: the ")" that balances its parentheses, a backslash escaping the next character
 * (CommonMark 0.31.2, "Links"). -1 when none does within MAX_DESTINATION characters, or before whitespace, which a
 * destination may not hold, or a bracket, which this subset does not link. A scan therefore never crosses the next
 * label, so all the scans together read each character at most once, however many links never close.
 */
function destinationEnd(text: string, from: number): number {
  let open = 0;
  const limit = Math.min(text.length, from + MAX_DESTINATION);
  for (let j = from; j < limit; j += 1) {
    const ch = text[j] ?? "";
    if (ch === "[" || ch === "]" || /\s/.test(ch)) return -1;
    if (ch === "\\") j += 1;
    else if (ch === "(") open += 1;
    else if (ch === ")") {
      if (open === 0) return j;
      open -= 1;
    }
  }
  return -1;
}

/**
 * The next index of `needle` at or after a position, remembered: parseInline only moves forward, so the text is
 * searched once per needle rather than once per opener (an unclosed "[" repeated would otherwise be quadratic).
 */
function nextIndex(text: string, needle: string): (from: number) => number {
  let searched = Number.POSITIVE_INFINITY;
  let found = -1;
  return (from) => {
    const stale = from < searched || (found !== -1 && found < from);
    if (stale) {
      searched = from;
      found = text.indexOf(needle, from);
    }
    return found;
  };
}

type Finders = {
  readonly labelClose: (from: number) => number;
  readonly bracket: (from: number) => number;
  readonly codeClose: (length: number, from: number) => number;
};

function takeLink(text: string, i: number, depth: number, find: Finders): Taken | null {
  if (text[i] !== "[") return null;
  const labelEnd = find.labelClose(i + 1);
  if (labelEnd === -1) return null;
  const inner = find.bracket(i + 1);
  if (inner !== -1 && inner < labelEnd) return null;
  const urlEnd = destinationEnd(text, labelEnd + 2);
  const url = urlEnd === -1 ? "" : text.slice(labelEnd + 2, urlEnd);
  const href = url === "" ? null : safeHref(url, WEB);
  if (href === null) return null;
  const children = parseInline(text.slice(i + 1, labelEnd), depth + 1, false);
  return { node: { kind: "link", href, children }, next: urlEnd + 1 };
}

function takeEmphasis(text: string, i: number, depth: number, links: boolean): Taken | null {
  const strong = text.startsWith("**", i) || text.startsWith("__", i);
  const mark = strong ? text.slice(i, i + 2) : text[i];
  if (mark === undefined || (mark !== "*" && mark !== "_" && !strong)) return null;
  if (mark.startsWith("_") && isWord(text[i - 1])) return null;
  const from = i + mark.length;
  let end = text.indexOf(mark, from);
  while (!strong && end !== -1 && text[end + 1] === mark) end = text.indexOf(mark, end + 2);
  if (end <= from || (mark.startsWith("_") && isWord(text[end + mark.length]))) return null;
  const children = parseInline(text.slice(from, end), depth + 1, links);
  return { node: { kind: strong ? "strong" : "em", children }, next: end + mark.length };
}

/** Left to right; anything that does not open a construct is text. Nested constructs stop at MAX_DEPTH. */
export function parseInline(text: string, depth = 0, links = true): Inline[] {
  const out: Inline[] = [];
  const find: Finders = {
    labelClose: nextIndex(text, "]("),
    bracket: nextIndex(text, "["),
    codeClose: codeCloser(text),
  };
  let buffer = "";
  for (let i = 0; i < text.length; ) {
    const taken =
      depth >= MAX_DEPTH
        ? null
        : (takeCode(text, i, find) ??
          (links ? (takeAutolink(text, i) ?? takeLink(text, i, depth, find)) : null) ??
          takeEmphasis(text, i, depth, links));
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
  for (const [pattern, ordered] of [
    [BULLET, false],
    [ORDERED, true],
  ] as const) {
    if (!pattern.test(line)) continue;
    const { items, next } = run(lines, i, pattern);
    return { block: { kind: "list", ordered, items: items.map((item) => parseInline(item)) }, next };
  }
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

// ---- Rendering ---------------------------------------------------------------------------------------------------

// Children.toArray keys each list by position: the text is rendered once, on the server, and never reordered.
const keyed = (nodes: readonly ReactNode[]) => Children.toArray(nodes);

function inlineNode(node: Inline): ReactNode {
  switch (node.kind) {
    case "text":
      return node.text;
    case "code":
      return <code>{node.text}</code>;
    case "strong":
      return <strong>{renderInline(node.children)}</strong>;
    case "em":
      return <em>{renderInline(node.children)}</em>;
    case "link":
      return (
        <a href={node.href} rel="nofollow ugc noopener noreferrer">
          {renderInline(node.children)}
        </a>
      );
  }
}

const renderInline = (nodes: readonly Inline[]) => keyed(nodes.map(inlineNode));

const listItem = (item: readonly Inline[]) => <li>{renderInline(item)}</li>;

function blockNode(block: Block): ReactNode {
  switch (block.kind) {
    case "heading": {
      // The card's own title is an h2 (ProfileCards), so README headings start one level below it.
      const Heading = (["h3", "h4", "h5"] as const)[block.level - 1] ?? "h5";
      return <Heading>{renderInline(block.children)}</Heading>;
    }
    case "paragraph":
      return <p>{renderInline(block.children)}</p>;
    case "quote":
      return (
        <blockquote>
          <p>{renderInline(block.children)}</p>
        </blockquote>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return <List>{keyed(block.items.map(listItem))}</List>;
    }
    case "code":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr />;
  }
}

/** The README's blocks, with no wrapper: the card supplies the container and its styles. */
export function Readme({ text }: { readonly text: string }) {
  return <>{keyed(parseReadme(text).map(blockNode))}</>;
}
