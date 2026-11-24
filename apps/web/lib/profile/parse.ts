// The Text card's Markdown (ADR 0051), read the way the editor reads it (book P1.21k): micromark 4.0.3 through
// mdast-util-from-markdown 2.1.0 makes the tree (CommonMark 0.31.2, https://spec.commonmark.org/0.31.2/), with four
// parts of GitHub Flavored Markdown (https://github.github.com/gfm/), as ADR 0086 lets readers extend CommonMark:
// tables, strikethrough, task list items and bare addresses. Tables are the only one that changes how the text is cut
// into blocks, so the page's top-level blocks are those of CommonMark plus GFM tables, which is the count a style is
// anchored by (ADR 0110). No footnotes. Math in GitHub's syntax is drawn (math.ts), so the page's own parse also reads
// micromark-extension-math 3.1.0, which makes a `$$` block one block where CommonMark makes paragraphs; looks are
// placed by `topBlocks`, which reads without it, as ADR 0110 decision 5 says ("a reader may still draw math its own
// way").
//
// The tree is then mapped to the blocks readme.svelte draws as escaped elements. micromark's own HTML is never used:
// raw HTML in the text is an `html` node, shown here as the text it is. A link is kept only when safeHref accepts it
// as http or https (shared/safe-href); otherwise its characters stay text. Images are not shown (there is no media
// proxy), so `![alt](url)` is a link to the image with its alt text.
//
// micromark is not bounded on hostile text (its readme, "Security": "process content in a different thread or worker
// so that it can be stopped when needed"; measured here, 20,000 characters of "_*" take seconds and deep nesting
// overflows the stack). So the server calls this only through a reader that stops it at a deadline and shows the card
// as plainText (interfaces/web text-reader.ts). Nothing here throws: any input renders.
import { type SafeHref, safeHref } from "@unset/shared-safe-href";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { mathFromMarkdown } from "mdast-util-math";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { math } from "micromark-extension-math";
import { drawMath, type MathBudget, type MathNode, mathBudget } from "./math.ts";

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "break" }
  /** A formula drawn in the line; `tex` is its source, a checkbox's name when it is a task's words. */
  | { readonly kind: "math"; readonly tex: string; readonly tree: MathNode }
  | { readonly kind: "strong" | "em" | "del"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: SafeHref; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: "heading"; readonly level: HeadingLevel; readonly children: readonly Inline[] }
  | { readonly kind: "paragraph"; readonly children: readonly Inline[] }
  | { readonly kind: "quote"; readonly paragraphs: readonly (readonly Inline[])[] }
  | ListBlock
  | CodeBlock
  | { readonly kind: "rule" }
  /** A formula on lines of its own, drawn as a display formula. */
  | { readonly kind: "math"; readonly tree: MathNode }
  | TableBlock;

/**
 * A code block's text and its language: a fence's info string's first word (CommonMark 0.31.2, "Fenced code blocks";
 * mdast `lang`), "" for none or an indented block. The language only picks the page's colours; it is never drawn.
 */
export type CodeBlock = { readonly kind: "code"; readonly text: string; readonly language: string };

/** A table's column alignments, header cells and data rows, each row as wide as the header (GFM "Tables"). */
export type TableBlock = {
  readonly kind: "table";
  readonly align: readonly ("left" | "center" | "right" | null)[];
  readonly head: readonly (readonly Inline[])[];
  readonly rows: readonly (readonly (readonly Inline[])[])[];
};

/** CommonMark's six heading levels. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type ListBlock = {
  readonly kind: "list";
  readonly ordered: boolean;
  /** An ordered list's first number, when it is not 1. */
  readonly start?: number;
  readonly items: readonly ListItem[];
};
/** A list item's text, the lists under it, and whether it is a task and ticked (GFM "Task list items"). */
export type ListItem = {
  readonly text: readonly Inline[];
  readonly lists: readonly ListBlock[];
  readonly task?: "open" | "done";
};

/**
 * The text block's ceiling in the lexicon is 20,000 bytes (sh.unset.block.text, ADR 0086), and a string is never
 * longer than its UTF-8 bytes, so no stored card is cut here; this only bounds what a caller can hand over.
 */
export const MAX_CHARS = 20_000;
/** A guard: blocks past this are not drawn. */
const MAX_BLOCKS = 2_000;
/** A guard: a table wider than this is shown as written. */
const MAX_COLUMNS = 50;
/**
 * A guard: the cells of all of one card's tables, header cells and the empty cells a short row is filled with
 * counted. A row of one character fills a whole row, so without it 20 kB of text could ask the server for half a
 * million cells. Rows past it are shown as written.
 */
const MAX_CELLS = 10_000;
/** Lists nest this deep; the items of a deeper list follow the item they were under. */
const MAX_LIST_DEPTH = 3;

const WEB = ["http:", "https:"] as const;

/** Struck words need two tildes each side (GFM "Strikethrough"); the editor is set the same (lib/editor/milkdown.ts). */
const READ = {
  extensions: [gfmTable(), gfmStrikethrough({ singleTilde: false }), gfmTaskListItem(), gfmAutolinkLiteral()],
  mdastExtensions: [
    gfmTableFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
    gfmAutolinkLiteralFromMarkdown(),
  ],
};

/** What the page draws from: READ, and math in GitHub's syntax, single dollars included (the extension's default). */
const DRAW = {
  extensions: [...READ.extensions, math()],
  mdastExtensions: [...READ.mdastExtensions, mathFromMarkdown()],
};

type Root = ReturnType<typeof fromMarkdown>;
type Flow = Root["children"][number];
type Of<Node extends { type: string }, Type extends Node["type"]> = Extract<Node, { type: Type }>;
type Phrasing = Of<Flow, "paragraph">["children"][number];
type MdList = Of<Flow, "list">;
type MdItem = MdList["children"][number];
type MdTable = Of<Flow, "table">;
type Offset = { readonly offset?: number | undefined };
type Positioned = { readonly position?: { readonly start: Offset; readonly end: Offset } | undefined };

/**
 * One card's text as it is read: the source, its link reference definitions, and what is left of its cell guard and
 * of its math budget.
 */
type Reading = {
  readonly source: string;
  readonly definitions: ReadonlyMap<string, string>;
  cells: number;
  readonly math: MathBudget;
};

// ---- Inline ------------------------------------------------------------------------------------------------------

/** C0 controls other than tab and line feed, and DEL: never drawn. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the controls are what this removes.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const shown = (value: string) => value.replace(CONTROLS, "");

/** Adds `nodes` to `out`, joining text that meets text and leaving out text with nothing to draw. */
function put(out: Inline[], nodes: readonly Inline[]): void {
  for (const node of nodes) {
    const last = out.at(-1);
    if (node.kind !== "text") out.push(node);
    else if (node.text === "") continue;
    else if (last?.kind === "text") out[out.length - 1] = { kind: "text", text: last.text + node.text };
    else out.push(node);
  }
}

/**
 * The characters from where `from` starts to where `to` ends, for what is shown as written; "" for a node the parser
 * made up, which has no position.
 */
function written(reading: Reading, from: Positioned, to: Positioned = from): string {
  const start = from.position?.start.offset;
  const end = to.position?.end.offset;
  return start === undefined || end === undefined ? "" : shown(reading.source.slice(start, end));
}

/**
 * A bare `www.` name opens over https (Alex 2026-11-21: "bare addresses become https"; GFM says http, and
 * mdast-util-gfm-autolink-literal 2.1.0 gives `http://` and the name). A bare link has no position, or starts where
 * its text starts, while `[name](url)` starts a bracket earlier (as lib/editor/milkdown.ts isBare reads it); a link
 * written out keeps its own address, http too.
 */
function address(node: Of<Phrasing, "link">): string {
  const [only, more] = node.children;
  if (only?.type !== "text" || more !== undefined || !/^www\./i.test(only.value)) return node.url;
  const bare = node.position === undefined || only.position?.start.offset === node.position.start.offset;
  return bare && node.url === `http://${only.value}` ? `https://${only.value}` : node.url;
}

/** An image's alt text as a link's words; none when it has none. */
function words(alt: string | null | undefined): Inline[] {
  const text = shown(alt ?? "");
  return text === "" ? [] : [{ kind: "text", text }];
}

/** A link when safeHref takes the address; otherwise the characters it was written with, or its words. */
function link(url: string | undefined, children: Inline[], node: Positioned, reading: Reading): Inline[] {
  const href = url === undefined || url === "" ? null : safeHref(url, WEB);
  if (href !== null) return [{ kind: "link", href, children }];
  const source = written(reading, node);
  return source === "" ? children : [{ kind: "text", text: source }];
}

function inline(node: Phrasing, reading: Reading): Inline[] {
  switch (node.type) {
    case "text":
    case "html":
      return [{ kind: "text", text: shown(node.value) }];
    case "inlineCode":
      return [{ kind: "code", text: shown(node.value) }];
    case "break":
      return [{ kind: "break" }];
    case "inlineMath":
      return (
        (pricesRule(node, reading) ? formulaInline(node.value, reading) : null) ?? [
          { kind: "text", text: written(reading, node) },
        ]
      );
    case "emphasis":
      return [{ kind: "em", children: inlines(node.children, reading) }];
    case "strong":
      return [{ kind: "strong", children: inlines(node.children, reading) }];
    case "delete":
      return [{ kind: "del", children: inlines(node.children, reading) }];
    case "link":
      return link(address(node), inlines(node.children, reading), node, reading);
    case "linkReference":
      return link(reading.definitions.get(node.identifier), inlines(node.children, reading), node, reading);
    case "image":
      return link(node.url, words(node.alt), node, reading);
    case "imageReference":
      return link(reading.definitions.get(node.identifier), words(node.alt), node, reading);
    default:
      // Footnotes are not read, so nothing reaches here; a node this does not know is shown as written.
      return [{ kind: "text", text: written(reading, node) }];
  }
}

function inlines(nodes: readonly Phrasing[], reading: Reading): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) put(out, inline(node, reading));
  return out;
}

/**
 * Whether math between single dollars keeps Pandoc's rule, as Milkdown's Crepe 7.23.0 holds the editor to it
 * (src/feature/latex/remark.ts, remarkInlineMathGuardPlugin): the opening dollar is followed by a non-space, the
 * closing one follows a non-space and is not followed by a digit, so "$5 and $10" stays words. Math between two or more
 * dollars is kept as written.
 */
function pricesRule(node: Positioned, reading: Reading): boolean {
  const raw = written(reading, node);
  if (raw.startsWith("$$")) return true;
  const after = reading.source[node.position?.end.offset ?? 0] ?? "";
  return !/^\$\s/.test(raw) && !/\s\$$/.test(raw) && !/\d/.test(after);
}

/** A formula in a line, or null when math.ts cannot draw it. */
function formulaInline(tex: string, reading: Reading): Inline[] | null {
  const tree = drawMath(tex, false, reading.math);
  return tree === null ? null : [{ kind: "math", tex, tree }];
}

// ---- Blocks ------------------------------------------------------------------------------------------------------

/** GitHub draws a fenced code block whose language is `math` as a formula. */
const isMathFence = (node: Of<Flow, "code">) => node.lang === "math";

/**
 * The paragraph Milkdown's preset-commonmark 7.23.0 wrote for an empty line before P1.21s (paragraph.ts
 * EMPTY_LINE_PLACEHOLDER, "<br />"): stored cards may hold it, and it shows nothing.
 */
const isEmptyLineMark = (html: string) => /^\s*<br\s*\/?>\s*$/i.test(html);

/** Lines of text with a line break between them. */
function lines(rows: readonly (readonly Inline[])[]): Inline[] {
  const out: Inline[] = [];
  rows.forEach((row, at) => {
    if (at > 0) out.push({ kind: "break" });
    put(out, row);
  });
  return out;
}

/** Code as lines of inline code. */
const codeLines = (value: string): Inline[] =>
  lines(value.split("\n").map((line): Inline[] => [{ kind: "code", text: shown(line) }]));

/**
 * What a quote or a list item shows of a block inside it. Both hold only lines of text (the view types, which
 * readme.svelte draws), so each paragraph, heading and table cell is its words, and code and raw HTML are their text,
 * line by line; a list's and a quote's own blocks follow in order, and their markers and rules are not drawn.
 */
function textLines(node: Flow, reading: Reading): Inline[][] {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return [inlines(node.children, reading)];
    case "math":
      return [formulaInline(node.value, reading) ?? codeLines(node.value)];
    case "code":
      return [(isMathFence(node) ? formulaInline(node.value, reading) : null) ?? codeLines(node.value)];
    case "html":
      return isEmptyLineMark(node.value) ? [] : [[{ kind: "text", text: shown(node.value) }]];
    case "blockquote":
      return node.children.flatMap((child) => textLines(child, reading));
    case "list":
      return node.children.flatMap((item) => item.children.flatMap((child) => textLines(child, reading)));
    case "table":
      return node.children.flatMap((row) => row.children.map((cell) => inlines(cell.children, reading)));
    default:
      return [];
  }
}

/**
 * A list item: its text is its own blocks' lines, and the lists written under it are its lists. Past MAX_LIST_DEPTH
 * a list's items follow the item instead, as its siblings.
 */
function listItems(node: MdItem, depth: number, reading: Reading): ListItem[] {
  const text: Inline[][] = [];
  const lists: ListBlock[] = [];
  const after: ListItem[] = [];
  for (const child of node.children) {
    if (child.type !== "list") text.push(...textLines(child, reading));
    else if (depth < MAX_LIST_DEPTH) lists.push(list(child, depth + 1, reading));
    else for (const item of child.children) after.push(...listItems(item, depth, reading));
  }
  const item: ListItem = { text: lines(text), lists };
  // mdast-util-gfm-task-list-item 2.0.1 sets `checked` on a task item and leaves it null on any other.
  const task = node.checked === true ? "done" : node.checked === false ? "open" : undefined;
  return [task === undefined ? item : { ...item, task }, ...after];
}

/** A bullet or ordered list; an ordered list keeps its first number when it is not 1 (CommonMark 0.31.2, "Lists"). */
function list(node: MdList, depth: number, reading: Reading): ListBlock {
  const items = node.children.flatMap((item) => listItems(item, depth, reading));
  const block: ListBlock = { kind: "list", ordered: node.ordered === true, items };
  const start = node.ordered === true ? (node.start ?? 1) : 1;
  return start === 1 ? block : { ...block, start };
}

const paragraphOf = (text: string): Block[] =>
  text === "" ? [] : [{ kind: "paragraph", children: [{ kind: "text", text }] }];

/**
 * A table: each row is filled with empty cells or cut to the header's width (GFM 0.29, "Tables (extension)"). One
 * wider than MAX_COLUMNS is shown as written, and so are the rows the card's cell guard has no room for.
 */
function table(node: MdTable, reading: Reading): Block[] {
  const [header, ...body] = node.children;
  const width = header?.children.length ?? 0;
  if (header === undefined || width > MAX_COLUMNS || reading.cells < width) return paragraphOf(written(reading, node));
  reading.cells -= width;
  const fits = Math.min(body.length, Math.floor(reading.cells / width));
  reading.cells -= fits * width;
  const rows = body
    .slice(0, fits)
    .map((row) => header.children.map((_, c) => inlines(row.children[c]?.children ?? [], reading)));
  const block: TableBlock = {
    kind: "table",
    align: header.children.map((_, c) => node.align?.[c] ?? null),
    head: header.children.map((cell) => inlines(cell.children, reading)),
    rows,
  };
  const left = body[fits];
  return left === undefined ? [block] : [block, ...paragraphOf(written(reading, left, node))];
}

/** A display formula, or its source as plain code when math.ts cannot draw it. */
function formulaBlock(tex: string, reading: Reading): Block {
  const tree = drawMath(tex, true, reading.math);
  return tree === null ? { kind: "code", text: shown(tex), language: "" } : { kind: "math", tree };
}

function block(node: Flow, reading: Reading): Block[] {
  switch (node.type) {
    case "heading":
      return [{ kind: "heading", level: node.depth, children: inlines(node.children, reading) }];
    case "paragraph":
      return [{ kind: "paragraph", children: inlines(node.children, reading) }];
    case "thematicBreak":
      return [{ kind: "rule" }];
    case "math":
      return [formulaBlock(node.value, reading)];
    case "code":
      if (isMathFence(node)) return [formulaBlock(node.value, reading)];
      return [{ kind: "code", text: shown(node.value), language: node.lang ?? "" }];
    case "blockquote": {
      const paragraphs = node.children.flatMap((child) => textLines(child, reading)).filter((line) => line.length > 0);
      return paragraphs.length === 0 ? [] : [{ kind: "quote", paragraphs }];
    }
    case "list":
      return [list(node, 1, reading)];
    case "table":
      return table(node, reading);
    case "html":
      // Raw HTML is never markup here: it is the text the member typed.
      return isEmptyLineMark(node.value) ? [] : paragraphOf(shown(node.value));
    default:
      // A link reference definition draws nothing (CommonMark 0.31.2, "Link reference definitions").
      return [];
  }
}

/**
 * Every link reference definition in the text, by its normalised label; the first of a label counts (CommonMark
 * 0.31.2, "Link reference definitions"). Read from the whole tree: one inside a quote or a list serves the document.
 */
function definitionsOf(root: Root): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (nodes: readonly { type: string }[]) => {
    for (const node of nodes) {
      if (isDefinition(node) && !found.has(node.identifier)) found.set(node.identifier, node.url);
      if ("children" in node && Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(root.children);
  return found;
}

const isDefinition = (node: { type: string }): node is Of<Flow, "definition"> => node.type === "definition";

/**
 * The text as it is read: line ends as LF, since CR and CRLF end a line as LF does (CommonMark 0.31.2, "Characters
 * and lines"), and without a leading byte order mark, which micromark 4.0.3 skips before it counts offsets
 * (micromark dev/lib/preprocess.js), so a node's offsets index this string.
 */
const normalised = (src: string) =>
  src
    .slice(0, MAX_CHARS)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");

/**
 * The text as written, for a card whose Markdown could not be read (stopped at the reader's deadline, or nested
 * deeper than the parser's stack): a paragraph per run of lines, a line break per line end, every character text.
 */
export function plainText(src: string): Block[] {
  const blocks: Block[] = [];
  let rows: Inline[][] = [];
  const close = () => {
    if (rows.length > 0) blocks.push({ kind: "paragraph", children: lines(rows) });
    rows = [];
  };
  for (const line of normalised(src).split("\n")) {
    const text = shown(line);
    if (text.trim() === "") close();
    else rows.push([{ kind: "text", text }]);
  }
  close();
  return blocks.slice(0, MAX_BLOCKS);
}

/**
 * The text's top-level blocks as a look is placed by (ADR 0110 decision 5): what CommonMark 0.31.2 with GFM tables
 * makes a child of the document, in order, each with its mdast kind and the lines it is written on, counted from 1.
 * A link reference definition is no block. The page draws from this same tree, so the two cannot disagree, and
 * parse.blocks.test.ts holds it to a parse with the table extension alone.
 */
export function topBlocks(src: string): { readonly kind: string; readonly from: number; readonly to: number }[] {
  return fromMarkdown(normalised(src), READ)
    .children.filter((node) => node.type !== "definition")
    .map((node) => ({ kind: node.type, from: node.position?.start.line ?? 0, to: node.position?.end.line ?? 0 }));
}

export function parseReadme(src: string): Block[] {
  const source = normalised(src);
  try {
    const root = fromMarkdown(source, DRAW);
    const reading: Reading = { source, definitions: definitionsOf(root), cells: MAX_CELLS, math: mathBudget() };
    const blocks: Block[] = [];
    for (const node of root.children) {
      if (blocks.length >= MAX_BLOCKS) break;
      blocks.push(...block(node, reading));
    }
    return blocks;
  } catch {
    // micromark recurses once per level of nesting, so thousands of nested quotes or lists overflow the stack
    // (a RangeError); such a card is shown as written rather than failing the page.
    return plainText(src);
  }
}
