// Enter and Shift+Enter in every Text editor, the card's dialog and the page alike (Alex, 2026-11-21: "swap the enter
// and shift enter everywhere"). Registered after the block menu's plugin, so an open menu still takes Enter, and before
// Milkdown's own keymap, which runs last (@milkdown/core 7.23.0 KeymapManager builds it after every prose plugin).
import { commandsCtx, type Editor } from "@milkdown/core";
import { insertHardbreakCommand, liftListItemCommand, splitListItemCommand } from "@milkdown/preset-commonmark";
import {
  chainCommands,
  createParagraphNear,
  exitCode,
  lift,
  liftEmptyBlock,
  splitBlock,
} from "@milkdown/prose/commands";
import { keymap } from "@milkdown/prose/keymap";
import type { Command } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

type Ctx = Parameters<Parameters<Editor["config"]>[0]>[0];

const inListItem = (state: Parameters<Command>[0]) => {
  const { $from } = state.selection;
  return $from.depth > 1 && $from.node(-1).type.name === "list_item";
};

const inQuote = (state: Parameters<Command>[0]) => {
  const { $from } = state.selection;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1)
    if ($from.node(depth).type.name === "blockquote") return true;
  return false;
};

/**
 * Three backticks (and a language) alone on a line, with the caret after them: Milkdown's code fence rule turns the
 * line into a code block on an Enter, Shift held or not (@milkdown/prose 7.23.0 inputRules handleKeyDown reads only
 * the key's name; preset-commonmark createCodeBlockInputRule). Both keys leave it to the rule, as the playground does.
 */
const FENCE = /^```[a-z]*$/;
const beforeFence = (state: Parameters<Command>[0]) => {
  const { $from, empty } = state.selection;
  return empty && $from.parent.type.name === "paragraph" && FENCE.test($from.parent.textBetween(0, $from.parentOffset));
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
    if (inListItem(state) || beforeFence(state)) return false;
    return ctx.get(commandsCtx).call(insertHardbreakCommand.key);
  };

const startBlock = chainCommands(createParagraphNear, liftEmptyBlock, splitBlock);

/**
 * Shift+Enter starts a new block: what Enter did (prosemirror-commands 1.7.2 baseKeymap's Enter without its
 * newlineInCode), and leaves a code block (exitCode, as Mod-Enter). In a list or a quote it starts a block after it,
 * where Enter makes another point or line (Alex 2026-11-22 00:02Z, for lists; quotes the same): the block is split at
 * the caret and its second half lifted out of every list and quote, so the words after the caret, if any, are that
 * block, and what followed stays a list or a quote below.
 */
const newBlock =
  (ctx: Ctx): Command =>
  (state, dispatch, view) => {
    if (state.selection.$from.parent.type.spec.code) return exitCode(state, dispatch);
    if (beforeFence(state)) return false;
    const inside = inListItem(state) || inQuote(state);
    if (!inside) return startBlock(state, dispatch, view);
    if (dispatch === undefined || view === undefined) return true;
    const commands = ctx.get(commandsCtx);
    if (inListItem(state)) commands.call(splitListItemCommand.key);
    else splitBlock(state, dispatch);
    // Out of each list and quote it is in, the innermost first; they nest at most a few levels.
    for (let depth = 0; depth < 8; depth += 1) {
      const out = inListItem(view.state)
        ? commands.call(liftListItemCommand.key)
        : inQuote(view.state) && lift(view.state, view.dispatch);
      if (!out) break;
    }
    return true;
  };

export const enterKeys = $prose((ctx) => keymap({ Enter: breakLine(ctx), "Shift-Enter": newBlock(ctx) }));
