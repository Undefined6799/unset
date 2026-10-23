// The member-written markdown subset (first user: the profile README, Alex 2026-10-23 02:32Z "README subset plus
// columns"; widens book P2.20's paragraphs-and-links subset, ADR to follow). It has no product meaning, so any feature
// may use it (Alex, 03:00Z). Members write it, so the parser is total: it never throws, there is no
// HTML pass-through, and anything it does not recognise stays literal text that React escapes. A link is kept only
// when safeHref accepts it as https or a path on our origin (shared/ui/safe-href.ts, P1.24h).
//
// Layout: a line "---" starts a new row; inside a row, a line ":::" starts a new column (at most three). Blocks:
// headings (# and ## are section headings, ### a subheading), paragraphs (single newlines kept as line breaks),
// "- "/"* " and "1. " lists, "> " quotes and ``` fenced code. Inlines: **strong**, *em*, `code` and [label](url),
// with no nesting beyond text inside a mark.
import { type SafeHref, safeHref } from "../../safe-href.ts";

export const MARKDOWN_LIMITS = { characters: 10_000, blocks: 200, columns: 3 } as const;

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong" | "em"; readonly children: readonly Inline[] }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly href: SafeHref; readonly children: readonly Inline[] };

type Line = readonly Inline[];

export type Block =
  | { readonly kind: "h"; readonly level: 2 | 3; readonly children: Line }
  | { readonly kind: "p" | "quote"; readonly lines: readonly Line[] }
  | { readonly kind: "ul" | "ol"; readonly items: readonly Line[] }
  | { readonly kind: "code"; readonly text: string };

export type MarkdownDocument = { readonly rows: readonly { readonly columns: readonly (readonly Block[])[] }[] };

/** Removes C0 controls except tab and newline, plus DEL; normalises line ends; cuts at the character limit. */
function clean(source: string): string {
  const unified = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let out = "";
  let count = 0;
  for (const character of unified) {
    if (count >= MARKDOWN_LIMITS.characters) break;
    count += 1;
    const code = character.codePointAt(0) ?? 0;
    if ((code < 0x20 && character !== "\n" && character !== "\t") || code === 0x7f) continue;
    out += character;
  }
  return out;
}

type Taken = { readonly inline: Inline; readonly next: number };

function takeMark(text: string, i: number, mark: "**" | "*" | "`"): Taken | null {
  if (!text.startsWith(mark, i)) return null;
  if (mark === "*" && text[i + 1] === "*") return null;
  const end = text.indexOf(mark, i + mark.length);
  if (end <= i + mark.length) return null;
  const inner = text.slice(i + mark.length, end);
  const next = end + mark.length;
  if (mark === "`") return { inline: { kind: "code", text: inner }, next };
  return { inline: { kind: mark === "**" ? "strong" : "em", children: [{ kind: "text", text: inner }] }, next };
}

function takeLink(text: string, i: number): Taken | null {
  if (text[i] !== "[") return null;
  const labelEnd = text.indexOf("](", i + 1);
  if (labelEnd <= i + 1) return null;
  const hrefEnd = text.indexOf(")", labelEnd + 2);
  if (hrefEnd === -1) return null;
  const href = safeHref(text.slice(labelEnd + 2, hrefEnd), ["https:", "path"]);
  if (href === null) return null;
  return {
    inline: { kind: "link", href, children: [{ kind: "text", text: text.slice(i + 1, labelEnd) }] },
    next: hrefEnd + 1,
  };
}

function parseInlines(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  for (let i = 0; i < text.length; ) {
    const taken = takeLink(text, i) ?? takeMark(text, i, "**") ?? takeMark(text, i, "*") ?? takeMark(text, i, "`");
    if (taken) {
      if (buffer !== "") out.push({ kind: "text", text: buffer });
      buffer = "";
      out.push(taken.inline);
      i = taken.next;
      continue;
    }
    // An unclosed "**" stays two literal stars, so its second star never opens an emphasis.
    const step = text.startsWith("**", i) ? 2 : 1;
    buffer += text.slice(i, i + step);
    i += step;
  }
  if (buffer !== "") out.push({ kind: "text", text: buffer });
  return out;
}

const HEADING = /^(#{1,3}) +(\S.*)$/;
const BULLET = /^[-*] +(.*)$/;
const NUMBERED = /^\d{1,3}\. +(.*)$/;
const QUOTE = /^> ?(.*)$/;

const isBlank = (line: string) => line.trim() === "";
const isFence = (line: string) => line.trim().startsWith("```");
const startsBlock = (line: string) =>
  isBlank(line) || isFence(line) || HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line) || QUOTE.test(line);

type Parsed = { readonly block: Block; readonly next: number };

function listBlock(lines: readonly string[], i: number, pattern: RegExp, kind: "ul" | "ol"): Parsed {
  const items: Line[] = [];
  let next = i;
  for (let match = pattern.exec(lines[next] ?? ""); match; match = pattern.exec(lines[next] ?? "")) {
    items.push(parseInlines(match[1] ?? ""));
    next += 1;
  }
  return { block: { kind, items }, next };
}

function codeBlock(lines: readonly string[], i: number): Parsed {
  let next = i + 1;
  const body: string[] = [];
  while (next < lines.length && !isFence(lines[next] ?? "")) body.push(lines[next++] ?? "");
  return { block: { kind: "code", text: body.join("\n") }, next: next + 1 };
}

function quoteBlock(lines: readonly string[], i: number): Parsed {
  const out: Line[] = [];
  let next = i;
  for (let match = QUOTE.exec(lines[next] ?? ""); match; match = QUOTE.exec(lines[next] ?? "")) {
    out.push(parseInlines(match[1] ?? ""));
    next += 1;
  }
  return { block: { kind: "quote", lines: out }, next };
}

function paragraphBlock(lines: readonly string[], i: number): Parsed {
  const out: Line[] = [parseInlines(lines[i] ?? "")];
  let next = i + 1;
  while (next < lines.length && !startsBlock(lines[next] ?? "")) out.push(parseInlines(lines[next++] ?? ""));
  return { block: { kind: "p", lines: out }, next };
}

function blockAt(lines: readonly string[], i: number): Parsed {
  const line = lines[i] ?? "";
  if (isFence(line)) return codeBlock(lines, i);
  const heading = HEADING.exec(line);
  if (heading) {
    const level = (heading[1] ?? "").length === 3 ? 3 : 2;
    return { block: { kind: "h", level, children: parseInlines(heading[2] ?? "") }, next: i + 1 };
  }
  if (BULLET.test(line)) return listBlock(lines, i, BULLET, "ul");
  if (NUMBERED.test(line)) return listBlock(lines, i, NUMBERED, "ol");
  if (QUOTE.test(line)) return quoteBlock(lines, i);
  return paragraphBlock(lines, i);
}

/** Splits the lines at row and column markers. A fourth column marker in a row stays ordinary text. */
function layout(lines: readonly string[]): string[][][] {
  const rows: string[][][] = [[[]]];
  let inFence = false;
  for (const line of lines) {
    const row = rows[rows.length - 1] ?? [];
    const marker = inFence ? "" : line.trim();
    if (isFence(line)) inFence = !inFence;
    if (marker === "---") rows.push([[]]);
    else if (marker === ":::" && row.length < MARKDOWN_LIMITS.columns) row.push([]);
    else row[row.length - 1]?.push(line);
  }
  return rows;
}

/** The blocks of one column, spending from the document's shared block budget. */
function columnBlocks(lines: readonly string[], budget: { left: number }): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length && budget.left > 0; ) {
    if (isBlank(lines[i] ?? "")) {
      i += 1;
      continue;
    }
    const { block, next } = blockAt(lines, i);
    blocks.push(block);
    budget.left -= 1;
    i = next;
  }
  return blocks;
}

/** Parses member-written markdown into rows of columns of blocks. Never throws. */
export function parseMarkdown(source: string): MarkdownDocument {
  const budget = { left: MARKDOWN_LIMITS.blocks as number };
  const rows: { columns: Block[][] }[] = [];
  for (const rowLines of layout(clean(source).split("\n"))) {
    const columns = rowLines.map((lines) => columnBlocks(lines, budget)).filter((blocks) => blocks.length > 0);
    if (columns.length > 0) rows.push({ columns });
  }
  return { rows };
}
