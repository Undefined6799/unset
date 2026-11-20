// The Text card's rich editor (ADR 0073, P1.21u): Milkdown 7.23.0's core and CommonMark preset, the only place
// that imports @milkdown (scripts/lint/.dependency-cruiser.cjs vendor-sdk-one-adapter). Milkdown reads and writes
// markdown through remark (https://milkdown.dev/docs/guide/using-plugins, remark-stringify 11 options), so the
// stored value stays the app's markdown and the server's parser (lib/profile/parse.ts) stays the authority. The
// stringify options below keep its output inside what that parser reads the same way: `-` bullets, `*` emphasis,
// backtick fences, a `---` rule, and a soft line break where remark would write a backslash break the parser shows
// as text. Loaded only when a member opens the Text editor (text-editor.svelte imports this file dynamically).
// Changes are reported once per animation frame, not after @milkdown/plugin-listener's 200 ms debounce, so a save
// pressed right after typing never posts stale text; the caller also reads `markdown()` as the form is sent.
import {
  defaultValueCtx,
  Editor,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/core";
import { history, redoCommand, undoCommand } from "@milkdown/plugin-history";
import {
  commonmark,
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/preset-commonmark";
import { Plugin } from "@milkdown/prose/state";
import { $prose, callCommand, getMarkdown } from "@milkdown/utils";
import "@milkdown/prose/view/style/prosemirror.css";

/** The toolbar's actions, by name; each is a command of the CommonMark preset. */
const COMMANDS = {
  strong: () => callCommand(toggleStrongCommand.key),
  emphasis: () => callCommand(toggleEmphasisCommand.key),
  code: () => callCommand(toggleInlineCodeCommand.key),
  heading: () => callCommand(wrapInHeadingCommand.key, 2),
  bullets: () => callCommand(wrapInBulletListCommand.key),
  numbers: () => callCommand(wrapInOrderedListCommand.key),
  quote: () => callCommand(wrapInBlockquoteCommand.key),
  codeBlock: () => callCommand(createCodeBlockCommand.key),
  undo: () => callCommand(undoCommand.key),
  redo: () => callCommand(redoCommand.key),
} as const;
export type EditorCommand = keyof typeof COMMANDS;

export type MarkdownEditor = {
  readonly run: (command: EditorCommand) => void;
  /** The markdown the editor holds now. */
  readonly markdown: () => string;
  readonly focus: () => void;
  readonly destroy: () => Promise<void>;
};

export type MountOptions = {
  readonly value: string;
  /** The id of the label that names the editor. Its description and state are the caller's to set. */
  readonly labelledBy: string;
  /** Called with the markdown after every change the member makes. */
  readonly onChange: (markdown: string) => void;
};

/** remark-stringify ends the document with a line feed; the plain field never did, so neither does the editor. */
const withoutFinalNewline = (markdown: string) => markdown.replace(/\n$/, "");

export async function mountMarkdownEditor(root: HTMLElement, options: MountOptions): Promise<MarkdownEditor> {
  let frame = 0;
  const changes = $prose(
    (ctx) =>
      new Plugin({
        view: () => ({
          update: (view, previous) => {
            if (previous.doc.eq(view.state.doc) || frame !== 0) return;
            frame = requestAnimationFrame(() => {
              frame = 0;
              options.onChange(withoutFinalNewline(ctx.get(serializerCtx)(view.state.doc)));
            });
          },
          destroy: () => cancelAnimationFrame(frame),
        }),
      }),
  );
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, options.value);
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        bullet: "-" as const,
        rule: "-" as const,
        handlers: { ...prev.handlers, break: () => "\n" },
      }));
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": options.labelledBy,
          class: "markdown-editor",
          spellcheck: "true",
        },
      }));
    })
    .use(commonmark)
    .use(history)
    .use(changes)
    .create();
  return {
    run: (command) => editor.action(COMMANDS[command]()),
    markdown: () => withoutFinalNewline(editor.action(getMarkdown())),
    focus: () => root.querySelector<HTMLElement>("[contenteditable]")?.focus(),
    destroy: async () => {
      await editor.destroy();
    },
  };
}
