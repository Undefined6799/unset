// The blocks the owner's editor offers (ADR 0037 point 4): exactly what the sh.unset.profile README holds, so nothing
// typed here is dropped on save. BlockNote 0.56.0's block and style specs (@blocknote/core src/blocks/defaultBlocks.ts):
// headings stop at level 3, display text is our own block, and colours, images, tables and toggles are not in the schema
// at all.
import {
  BlockNoteSchema,
  type BlockSpec,
  createBlockSpec,
  createBulletListItemBlockSpec,
  createCheckListItemBlockSpec,
  createCodeBlockSpec,
  createHeadingBlockSpec,
  createNumberedListItemBlockSpec,
  createParagraphBlockSpec,
  createQuoteBlockSpec,
  defaultInlineContentSpecs,
  defaultProps,
  defaultStyleSpecs,
} from "@blocknote/core";

const { bold, italic, underline, strike, code } = defaultStyleSpecs;

// Toggle headings are off, so the spec has no isToggleable prop at all (src/blocks/Heading/block.ts:63). Its declared
// type still lists the prop as `T | undefined`, which exactOptionalPropertyTypes refuses as a PropSchema; this type
// says what the spec holds when toggles are off.
type HeadingProps = Omit<ReturnType<typeof createHeadingBlockSpec>["config"]["propSchema"], "isToggleable">;
const heading = createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }) as unknown as BlockSpec<
  "heading",
  HeadingProps,
  "inline"
>;

// Columns (Alex 2026-10-23 23:31Z: drag a block beside another to make columns). The README stores them as its columns
// block (P2.20w), and the editor holds them in BlockNote's multi-column JSON shape, which parseReadme already reads: a
// columnList whose children are columns, each column's children its blocks. BlockNote's own multi-column package is
// GPL-only and needs @blocknote/react, so these are two plain container blocks with no content of their own; the
// layout is CSS (Editor.module.css) and the drop is columns.ts.
const container = (type: "columnList" | "column") =>
  createBlockSpec(
    { type, propSchema: {}, content: "none" },
    {
      render() {
        return { dom: document.createElement("div") };
      },
    },
  )();

// Display text (Alex 2026-10-24 00:08Z: "the display text, like in the design sheet"): the sheet's display style as a
// block of inline text that can be aligned, as a paragraph can.
const display = createBlockSpec(
  { type: "display", propSchema: { textAlignment: defaultProps.textAlignment }, content: "inline" },
  {
    render() {
      const dom = document.createElement("p");
      return { dom, contentDOM: dom };
    },
  },
)();

export const readmeSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: createParagraphBlockSpec(),
    display,
    heading,
    bulletListItem: createBulletListItemBlockSpec(),
    numberedListItem: createNumberedListItemBlockSpec(),
    checkListItem: createCheckListItemBlockSpec(),
    quote: createQuoteBlockSpec(),
    codeBlock: createCodeBlockSpec(),
    columnList: container("columnList"),
    column: container("column"),
  },
  styleSpecs: { bold, italic, underline, strike, code },
  inlineContentSpecs: defaultInlineContentSpecs,
});

export type ReadmeEditor = typeof readmeSchema.BlockNoteEditor;
export type ReadmeBlock = typeof readmeSchema.Block;
export type ReadmePartialBlock = typeof readmeSchema.PartialBlock;

/** The text styles the toolbar toggles, in its order. */
export const TEXT_STYLES = ["bold", "italic", "underline", "strike", "code"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

/** The alignments the toolbar sets, in its order: the ones the README stores (domains/profile readme.ts Align), and
 * left, which clears them. BlockNote's justify is not offered, since the README does not keep it. */
export const ALIGNMENTS = ["left", "center", "right"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];
