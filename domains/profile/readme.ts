// The profile README (Alex, 2026-10-23 21:08Z: edited with BlockNote, the logic on the backend). The owner's editor
// posts BlockNote's document; it is untrusted input, read here once (DM-1) into our own block model, the one the
// sh.unset.profile lexicon stores (P2.20w). Anything the model does not hold (colours, alignment, images, tables,
// unknown blocks) is dropped, never passed through. BlockNote's document shape is read from @blocknote/core 0.56.0:
// blocks are { type, props, content, children } (src/schema/blocks/types.ts BlockFromConfigNoChildren), inline content
// is { type: "text", text, styles } or { type: "link", href, content } (src/schema/inlineContent/types.ts), and a code
// block's content is plain text runs (PlainContent).
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { isWebsite } from "./web-address.ts";

const DEFS = "sh.unset.profile#";
export type TextRun = {
  readonly $type: `${typeof DEFS}textRun`;
  readonly text: string;
  readonly bold?: true;
  readonly italic?: true;
  readonly underline?: true;
  readonly strike?: true;
  readonly code?: true;
};
export type LinkRun = { readonly $type: `${typeof DEFS}linkRun`; readonly uri: string; readonly content: TextRun[] };
export type Run = TextRun | LinkRun;
export type ReadmeBlock =
  | { readonly $type: `${typeof DEFS}paragraph`; readonly content: Run[] }
  | { readonly $type: `${typeof DEFS}heading`; readonly level: 1 | 2 | 3; readonly content: Run[] }
  | {
      readonly $type: `${typeof DEFS}listItem`;
      readonly style: "bullet" | "numbered" | "check";
      readonly indent?: number;
      readonly checked?: true;
      readonly content: Run[];
    }
  | { readonly $type: `${typeof DEFS}quote`; readonly content: Run[] }
  | { readonly $type: `${typeof DEFS}codeBlock`; readonly text: string; readonly language?: string };
export type ColumnsBlock = {
  readonly $type: `${typeof DEFS}columns`;
  readonly columns: { readonly blocks: ReadmeBlock[] }[];
};
export type Readme = { readonly blocks: (ReadmeBlock | ColumnsBlock)[] };

export type ReadmeError = "profile.invalid" | "profile.too_long";
export type ParsedReadme =
  | { readonly ok: true; readonly readme: Readme }
  | { readonly ok: false; readonly code: ReadmeError };

/** The posted document's size before it is parsed; the stored README is held to the same bytes as JSON. */
export const README_BYTES = 100_000;
/** BlockNote nests list items by children; deeper than this reads as the deepest indent. */
const LIST_STYLES = { bulletListItem: "bullet", numberedListItem: "numbered", checkListItem: "check" } as const;
const STYLES = ["bold", "italic", "underline", "strike", "code"] as const;

const KNOWN: ReadonlySet<string> = new Set(
  ["paragraph", "heading", "listItem", "quote", "codeBlock", "columns"].map((def) => `${DEFS}${def}`),
);

class TooLong extends Error {}

type Node = Readonly<Record<string, unknown>>;
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function checkLength(text: string, limit: number): string {
  let count = 0;
  for (const _ of segmenter.segment(text)) if (++count > limit) throw new TooLong();
  return text;
}

function textRun(value: unknown): TextRun | null {
  if (!isNode(value) || value.type !== "text" || typeof value.text !== "string" || value.text === "") return null;
  const styles = isNode(value.styles) ? value.styles : {};
  const run: Record<string, unknown> = {
    $type: `${DEFS}textRun`,
    text: checkLength(value.text, LIMITS.profile.readmeRunText),
  };
  for (const style of STYLES) if (styles[style] === true) run[style] = true;
  return run as TextRun;
}

/** A link's text runs; a link to anything but a plain http(s) address keeps its text and loses the link. */
function linkRuns(item: Node): Run[] {
  const content = list(item.content)
    .map(textRun)
    .filter((run) => run !== null);
  if (content.length > LIMITS.profile.readmeLinkRunsMax) throw new TooLong();
  const uri = typeof item.href === "string" ? item.href : "";
  const ok = isWebsite(uri) && new TextEncoder().encode(uri).length <= LIMITS.profile.readmeLinkUriBytes;
  if (content.length === 0) return [];
  return ok ? [{ $type: `${DEFS}linkRun`, uri, content }] : content;
}

/** Inline content, in reading order. */
function runs(value: unknown): Run[] {
  const out = list(value).flatMap((item) => {
    if (isNode(item) && item.type === "link") return linkRuns(item);
    const run = textRun(item);
    return run ? [run] : [];
  });
  if (out.length > LIMITS.profile.readmeRunsMax) throw new TooLong();
  return out;
}

function codeBlock(block: Node): ReadmeBlock {
  const text = list(block.content)
    .map((run) => (isNode(run) && typeof run.text === "string" ? run.text : ""))
    .join("");
  const props = isNode(block.props) ? block.props : {};
  const language = typeof props.language === "string" ? props.language : "";
  const keep =
    language !== "" && language.length <= LIMITS.profile.readmeCodeLanguageBytes && /^[\w+#.-]+$/.test(language);
  return {
    $type: `${DEFS}codeBlock`,
    text: checkLength(text, LIMITS.profile.readmeCode),
    ...(keep ? { language } : {}),
  };
}

/** One BlockNote block without its children, or null for a block the model does not hold. */
function block(value: Node, depth: number): ReadmeBlock | null {
  const props = isNode(value.props) ? value.props : {};
  const type = value.type;
  if (type === "paragraph" || type === "quote") return { $type: `${DEFS}${type}`, content: runs(value.content) };
  if (type === "heading") {
    const level = props.level === 1 || props.level === 2 ? props.level : 3;
    return { $type: `${DEFS}heading`, level, content: runs(value.content) };
  }
  if (type === "codeBlock") return codeBlock(value);
  if (typeof type !== "string" || !Object.hasOwn(LIST_STYLES, type)) return null;
  const style = LIST_STYLES[type as keyof typeof LIST_STYLES];
  const indent = Math.min(depth, LIMITS.profile.readmeIndentMax);
  return {
    $type: `${DEFS}listItem`,
    style,
    ...(indent > 0 ? { indent } : {}),
    ...(style === "check" && props.checked === true ? { checked: true as const } : {}),
    content: runs(value.content),
  };
}

/** One BlockNote block and its children, flattened in reading order; `depth` is its nesting under list items. */
function blocks(value: unknown, depth: number): ReadmeBlock[] {
  if (!isNode(value)) return [];
  const own = block(value, depth);
  // A block the model does not hold is dropped with its children.
  return own === null ? [] : [own, ...list(value.children).flatMap((child) => blocks(child, depth + 1))];
}

/** BlockNote's column list: two or three columns side by side; one column reads as its blocks. */
function columnList(value: Node): (ReadmeBlock | ColumnsBlock)[] {
  const columns = list(value.children)
    .filter((column) => isNode(column) && column.type === "column")
    .map((column) => list((column as Node).children).flatMap((child) => blocks(child, 0)))
    .filter((column) => column.length > 0);
  if (columns.length > LIMITS.profile.readmeColumnsMax) throw new TooLong();
  if (columns.some((column) => column.length > LIMITS.profile.readmeColumnBlocksMax)) throw new TooLong();
  if (columns.length < 2) return columns.flat();
  return [{ $type: `${DEFS}columns`, columns: columns.map((column) => ({ blocks: column })) }];
}

/** Reads the editor's posted document (BlockNote JSON) into the README the record stores. */
export function parseReadme(posted: string): ParsedReadme {
  if (new TextEncoder().encode(posted).length > README_BYTES) return { ok: false, code: "profile.too_long" };
  let document: unknown;
  try {
    document = JSON.parse(posted);
  } catch {
    return { ok: false, code: "profile.invalid" };
  }
  if (!Array.isArray(document)) return { ok: false, code: "profile.invalid" };
  try {
    const out = document.flatMap((block) =>
      isNode(block) && block.type === "columnList" ? columnList(block) : blocks(block, 0),
    );
    if (out.length > LIMITS.profile.readmeBlocksMax) return { ok: false, code: "profile.too_long" };
    const readme = { blocks: out };
    if (new TextEncoder().encode(JSON.stringify(readme)).length > README_BYTES) {
      return { ok: false, code: "profile.too_long" };
    }
    return { ok: true, readme };
  } catch (error) {
    if (error instanceof TooLong) return { ok: false, code: "profile.too_long" };
    throw error;
  }
}

/** A README the staging preview stored as markdown (ADR 0037 point 8): each paragraph as plain text, or null. */
function legacyReadme(text: string): Readme | null {
  const blocks = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map(
      (paragraph): ReadmeBlock => ({
        $type: `${DEFS}paragraph`,
        content: [{ $type: `${DEFS}textRun`, text: paragraph }],
      }),
    );
  return { blocks };
}

/**
 * The README of a record read back from a member's PDS. Another client may have written it, so it is kept only when
 * the lexicon's validator accepts it and it is within README_BYTES, and only the block types this app renders are
 * kept; anything else reads as no README, never as a failure of the page.
 */
export function readStoredReadme(stored: unknown): Readme {
  const value = typeof stored === "string" ? legacyReadme(stored) : stored;
  const probe = { $type: "sh.unset.profile", displayName: "-", createdAt: "1970-01-01T00:00:00.000Z", readme: value };
  if (!isNode(value) || !validateRecord("sh.unset.profile", probe, "write").ok) return { blocks: [] };
  if (new TextEncoder().encode(JSON.stringify(value)).length > README_BYTES) return { blocks: [] };
  const known = (block: unknown) => isNode(block) && KNOWN.has(String(block.$type));
  const blocks = list(value.blocks)
    .filter(known)
    .map((block) =>
      (block as Node).$type === `${DEFS}columns`
        ? {
            ...(block as ColumnsBlock),
            columns: (block as ColumnsBlock).columns.map((c) => ({ blocks: c.blocks.filter(known) })),
          }
        : block,
    );
  return { blocks: blocks as Readme["blocks"] };
}
