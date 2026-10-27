// English text for the owner's README editor. One catalog per feature until the i18n slice (P1.19).

export const EDITOR = {
  placeholder: "Write, or type / for blocks",
  toolbar: "Text style",
  styles: { bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strike", code: "Code" },
  /** BlockNote's text alignment buttons (Alex 2026-10-23 23:57Z). */
  align: { left: "Align left", center: "Align centre", right: "Align right" },
  alignment: "Alignment",
  blockType: "Block type",
  /** The display block's entries in the block menus, as BlockNote's dictionary words its own. */
  display: { title: "Display", subtext: "The largest text, for a hero line", aliases: ["display", "hero", "big"] },
  link: "Link",
  linkUrl: "Link address",
  linkApply: "Apply",
  slashMenu: "Blocks",
  noMatch: "No block matches",
  addBlock: "Add a block below",
  blockMenu: "Drag to move, or click for this block's menu",
  blockActions: "Block actions",
  gestureHint: "At a block’s edge, hold and drag to move. Double tap for actions. Gestures on text select words.",
  moveUp: "Move up",
  moveDown: "Move down",
  done: "Done",
  close: "Close",
  deleteBlock: "Delete",
  blocks: {
    paragraph: "Text",
    heading1: "Heading 1",
    heading2: "Heading 2",
    heading3: "Heading 3",
    bulletListItem: "Bullet list",
    numberedListItem: "Numbered list",
    checkListItem: "Check list",
    quote: "Quote",
    codeBlock: "Code",
  },
} as const;
