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
const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
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

function takeCode(text: string, i: number): Taken | null {
  if (text[i] !== "`") return null;
  const end = text.indexOf("`", i + 1);
  return end === -1 ? null : { node: { kind: "code", text: text.slice(i + 1, end) }, next: end + 1 };
}

function takeAutolink(text: string, i: number): Taken | null {
  const match = text[i] === "<" ? /^<(https?:\/\/[^\s<>]+)>/i.exec(text.slice(i)) : null;
  const href = match?.[1] === undefined ? null : safeHref(match[1], WEB);
  if (match === null || href === null) return null;
  return { node: { kind: "link", href, children: [{ kind: "text", text: href }] }, next: i + match[0].length };
}

function takeLink(text: string, i: number, depth: number): Taken | null {
  if (text[i] !== "[") return null;
  const labelEnd = text.indexOf("](", i + 1);
  if (labelEnd === -1 || text.slice(i + 1, labelEnd).includes("[")) return null;
  const urlEnd = text.indexOf(")", labelEnd + 2);
  const url = urlEnd === -1 ? "" : text.slice(labelEnd + 2, urlEnd);
  const href = url === "" || /\s/.test(url) ? null : safeHref(url, WEB);
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
  let buffer = "";
  for (let i = 0; i < text.length; ) {
    const taken =
      depth >= MAX_DEPTH
        ? null
        : (takeCode(text, i) ??
          (links ? (takeAutolink(text, i) ?? takeLink(text, i, depth)) : null) ??
          takeEmphasis(text, i, depth, links));
    if (taken === null) {
      buffer += text[i];
      i += 1;
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
  HEADING.test(line) ||
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

/** A fenced code block; an unclosed fence runs to the end of the text, as CommonMark says. */
function takeFence(lines: readonly string[], i: number, fence: string): { block: Block; next: number } {
  const close = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence));
  const end = close === -1 ? lines.length : close;
  return { block: { kind: "code", text: lines.slice(i + 1, end).join("\n") }, next: end + 1 };
}

function takeBlock(lines: readonly string[], i: number): { block: Block | null; next: number } {
  const line = lines[i] ?? "";
  if (line.trim() === "") return { block: null, next: i + 1 };
  const fence = FENCE.exec(line)?.[1];
  if (fence !== undefined) return takeFence(lines, i, fence);
  const heading = HEADING.exec(line);
  if (heading !== null) {
    const level = Math.min((heading[1] ?? "#").length, 3) as 1 | 2 | 3;
    return { block: { kind: "heading", level, children: parseInline(heading[2] ?? "") }, next: i + 1 };
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
