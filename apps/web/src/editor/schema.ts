// The blocks the owner's editor offers (ADR 0037 point 4): exactly what the sh.unset.profile README holds, so nothing
// typed here is dropped on save. BlockNote 0.56.0's block and style specs (@blocknote/core src/blocks/defaultBlocks.ts):
// headings stop at level 3, and colours, alignment, images, tables and toggles are not in the schema at all.
import {
  BlockNoteSchema,
  type BlockSpec,
  createBulletListItemBlockSpec,
  createCheckListItemBlockSpec,
  createCodeBlockSpec,
  createHeadingBlockSpec,
  createNumberedListItemBlockSpec,
  createParagraphBlockSpec,
  createQuoteBlockSpec,
  defaultInlineContentSpecs,
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

export const readmeSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: createParagraphBlockSpec(),
    heading,
    bulletListItem: createBulletListItemBlockSpec(),
    numberedListItem: createNumberedListItemBlockSpec(),
    checkListItem: createCheckListItemBlockSpec(),
    quote: createQuoteBlockSpec(),
    codeBlock: createCodeBlockSpec(),
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
