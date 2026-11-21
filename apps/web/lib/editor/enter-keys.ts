// Enter and Shift+Enter in every Text editor, the card's dialog and the page alike (Alex, 2026-11-21: "swap the enter
// and shift enter everywhere"). Registered after the block menu's plugin, so an open menu still takes Enter, and before
// Milkdown's own keymap, which runs last (@milkdown/core 7.23.0 KeymapManager builds it after every prose plugin).
import { commandsCtx, type Editor } from "@milkdown/core";
import { insertHardbreakCommand, splitListItemCommand } from "@milkdown/preset-commonmark";
import { chainCommands, createParagraphNear, exitCode, liftEmptyBlock, splitBlock } from "@milkdown/prose/commands";
import { keymap } from "@milkdown/prose/keymap";
import type { Command } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

type Ctx = Parameters<Parameters<Editor["config"]>[0]>[0];

const inListItem = (state: Parameters<Command>[0]) => {
  const { $from } = state.selection;
  return $from.depth > 1 && $from.node(-1).type.name === "list_item";
};

/**
 * Enter breaks the line inside a paragraph, a quote's included (Milkdown's InsertHardbreak, which Shift+Enter ran: a
 * second Enter at a line's end turns the break into a new block). A heading is one line in Markdown and a list item's
 * line break does not show on the page (parse.ts), so there, and on an empty line, Enter keeps its old meaning and
 * falls through to Milkdown's own keys.
 */
const breakLine =
  (ctx: Ctx): Command =>
  (state) => {
    const { $from } = state.selection;
    if ($from.parent.type.name !== "paragraph" || $from.parent.content.size === 0) return false;
    if (inListItem(state)) return false;
    return ctx.get(commandsCtx).call(insertHardbreakCommand.key);
  };

const startBlock = chainCommands(createParagraphNear, liftEmptyBlock, splitBlock);

/**
 * Shift+Enter starts a new block: what Enter did (prosemirror-commands 1.7.2 baseKeymap's Enter without its
 * newlineInCode, and commonmark's NextListItem in a list), and leaves a code block (exitCode, as Mod-Enter). An empty
 * item that cannot split (prosemirror-schema-list 1.5 splitListItem declines one at the top level) is lifted out of
 * its list, which ends the list as a second Enter did.
 */
const newBlock =
  (ctx: Ctx): Command =>
  (state, dispatch, view) => {
    if (state.selection.$from.parent.type.spec.code) return exitCode(state, dispatch);
    if (inListItem(state) && ctx.get(commandsCtx).call(splitListItemCommand.key)) return true;
    return startBlock(state, dispatch, view);
  };

export const enterKeys = $prose((ctx) => keymap({ Enter: breakLine(ctx), "Shift-Enter": newBlock(ctx) }));
