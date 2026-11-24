// A code block in the Text editor is edited in CodeMirror 6, set in as a ProseMirror node view the way ProseMirror's
// own example does it (https://github.com/ProseMirror/website/blob/master/example/codemirror/index.js, the
// "Embedded code editor" example of prosemirror.net). The stored text stays a fenced Markdown block: the view only
// draws the commonmark preset's code_block node, whose text and `language` attribute are what Milkdown writes back.
//
// Why not Milkdown's own component (@milkdown/components 7.23.0 code-block): under the app's CSP it cannot run clean.
// Its Vue runtime asks for a pass-through Trusted Types policy named "vue" as it loads (@vue/runtime-dom 3.5.45), which
// the trusted-types directive refuses, and it hands CodeMirror the page's document as root, where style-mod writes a
// <style> element (style-mod 4.1 StyleSet: a constructed sheet only for a root without a head), which style-src
// refuses, so CodeMirror shows unstyled. Here CodeMirror lives in a shadow root of its own (@codemirror/view 6.43.15
// EditorViewConfig.root), where style-mod adopts a constructed style sheet, which style-src does not govern: the CSP
// and the Trusted Types rule stay as they are.
//
// Nothing in a code block is ever read as HTML: CodeMirror draws its document as text nodes, the language name is an
// input's value, and the copy button writes plain text to the clipboard. A math block (language "math", math.ts) shows
// its TeX drawn below the code, as MathML elements built one by one (math.ts mathElement).

import { defaultKeymap } from "@codemirror/commands";
import { LanguageDescription, type LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension, type Text, type Transaction } from "@codemirror/state";
import { EditorView as CodeMirror, drawSelection, type KeyBinding, keymap, type ViewUpdate } from "@codemirror/view";
import { codeBlockSchema } from "@milkdown/preset-commonmark";
import { exitCode } from "@milkdown/prose/commands";
import { redo, undo } from "@milkdown/prose/history";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { Selection, TextSelection } from "@milkdown/prose/state";
import type { EditorView, NodeView } from "@milkdown/prose/view";
import { $view } from "@milkdown/utils";
import { mount, unmount } from "svelte";
import { Icon } from "../components/icon/index.ts";
import { buttonVariants } from "../components/ui/button/index.ts";
import { CARD_TEXT } from "../profile/messages.ts";
import { CODE_COLOURS, type CodeColourLimits, codeHighlighter, colourable } from "./code-colours.ts";
import { drawInto, MATH_LANGUAGE, MathHold } from "./math.ts";

/** CodeMirror's look, drawn from the theme's colours (custom properties reach into the shadow root). */
const look = CodeMirror.theme({
  "&": { color: "var(--foreground)", backgroundColor: "transparent", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "var(--font-mono)", lineHeight: "20px", caretColor: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "inherit" },
  // The page's code colours (code-colours.ts): each class drawn with its theme variable, as apps/web/app.css does.
  ...Object.fromEntries(CODE_COLOURS.map(({ name }) => [`.code-${name}`, { color: `var(--code-${name})` }])),
  ".code-comment": { color: "var(--code-comment)", fontStyle: "italic" },
});

/** No language: the code shows as plain text. One value, so the compartment's content can be compared with it. */
const NONE: Extension = [];

class CodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  private readonly cm: CodeMirror;
  private readonly language = new Compartment();
  private readonly languageField: HTMLInputElement;
  private readonly preview: HTMLElement;
  /** The TeX the preview shows, or null when the block is no math block. */
  private previewed: string | null = null;
  private loaded = "";
  /** The loaded language, kept while the code is past the limits so it comes back once the code fits again. */
  private found: { readonly name: string; readonly support: LanguageSupport } | null = null;
  private updating = false;
  private copyIcon: ReturnType<typeof mount> | undefined;
  /** What the math preview took from the editor's math budget. */
  private readonly mathHold: MathHold;

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly limits: CodeColourLimits | undefined,
  ) {
    this.mathHold = new MathHold(view);
    this.dom = document.createElement("div");
    this.dom.className = "code-block flex flex-col gap-2 rounded-sm bg-muted px-4 py-3";
    this.languageField = this.languageInput();
    const tools = document.createElement("div");
    tools.className = "flex items-center justify-between gap-2";
    tools.append(this.languageField, this.copyButton());
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    this.cm = new CodeMirror({
      doc: node.textContent,
      root,
      parent: root,
      extensions: [
        keymap.of([...this.codeMirrorKeymap(), ...defaultKeymap]),
        drawSelection(),
        syntaxHighlighting(codeHighlighter),
        CodeMirror.lineWrapping,
        look,
        this.language.of(NONE),
        // In the change's own transaction, before CodeMirror parses the new text with the old language.
        EditorState.transactionExtender.of((tr) => this.followLimits(tr)),
        CodeMirror.updateListener.of((update) => this.forwardUpdate(update)),
        CodeMirror.domEventHandlers({ keydown: (event) => this.outerKey(event) }),
      ],
    });
    this.preview = document.createElement("div");
    this.preview.dataset.mathPreview = "";
    this.preview.className = "overflow-x-auto contain-paint";
    this.dom.append(tools, host, this.preview);
    this.loadLanguage(String(node.attrs.language ?? ""));
    this.drawPreview();
  }

  /** A math block's TeX drawn below it, redrawn when it changes; nothing below any other block. */
  private drawPreview() {
    const tex = this.node.attrs.language === MATH_LANGUAGE ? this.node.textContent : null;
    if (tex === this.previewed) return;
    this.previewed = tex;
    this.preview.hidden = tex === null;
    this.preview.replaceChildren();
    this.mathHold.release();
    if (tex !== null) void drawInto(this.preview, tex, true, () => this.previewed === tex, this.mathHold);
  }

  private languageInput(): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "h-7 w-40 rounded-md border border-input bg-background px-2 font-mono text-xs";
    input.setAttribute("aria-label", "Code language");
    input.placeholder = "Language";
    input.value = String(this.node.attrs.language ?? "");
    input.addEventListener("change", () => this.setLanguage(input.value.trim()));
    // The field sits in the card's form, whose Enter would save the card (Codex on #2003): Enter sets the language and
    // goes back to the code.
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      this.setLanguage(input.value.trim());
      this.cm.focus();
    });
    return input;
  }

  /** The stock outline button showing our Icon's copy drawing, as the page's code block has it (readme-copy.svelte). */
  private copyButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = buttonVariants({ variant: "outline", size: "icon-sm" });
    button.setAttribute("aria-label", CARD_TEXT.copyCode);
    this.copyIcon = mount(Icon, { target: button, props: { name: "copy", size: 16 } });
    button.addEventListener("click", () => {
      void navigator.clipboard?.writeText(this.cm.state.doc.toString());
    });
    return button;
  }

  private setLanguage(language: string) {
    const pos = this.getPos();
    // Enter sets it, then the field's change on blur would set it again.
    if (pos === undefined || String(this.node.attrs.language ?? "") === language) return;
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, "language", language));
  }

  /** Loads the language CodeMirror knows by that name or alias; an unknown name shows plain text. */
  private loadLanguage(name: string) {
    if (name === this.loaded) return;
    this.loaded = name;
    this.found = null;
    const found = LanguageDescription.matchLanguageName(languages, name, true);
    if (found === null) {
      this.cm.dispatch({ effects: this.language.reconfigure(NONE) });
      return;
    }
    void found.load().then((support) => {
      if (this.loaded !== name) return;
      this.found = { name: found.name, support };
      this.cm.dispatch({ effects: this.language.reconfigure(this.languageFor(this.cm.state.doc)) });
    });
  }

  /**
   * The language only while the page would colour the code too (code-colours.ts colourable): past its limits a stream
   * parser takes one long line in a step nothing interrupts, which would freeze the member's tab as it types. Without
   * the page's limits nothing is coloured.
   */
  private languageFor(doc: Text): Extension {
    const { found, limits } = this;
    if (found === null || limits === undefined) return NONE;
    return colourable(found.name, doc.toString(), limits) ? found.support : NONE;
  }

  /** Turns the language off in the change that takes the code past the limits, and back on in the one that ends it. */
  private followLimits(tr: Transaction) {
    if (!tr.docChanged || this.found === null) return null;
    const wanted = this.languageFor(tr.newDoc);
    return this.language.get(tr.startState) === wanted ? null : { effects: this.language.reconfigure(wanted) };
  }

  private forwardUpdate(update: ViewUpdate) {
    const pos = this.getPos();
    if (this.updating || !this.cm.hasFocus || pos === undefined) return;
    let offset = pos + 1;
    const { main } = update.state.selection;
    // Anchor and head, not from and to, so a selection made backwards stays backwards (Codex on #2003).
    const selFrom = offset + main.anchor;
    const selTo = offset + main.head;
    const pmSel = this.view.state.selection;
    if (!update.docChanged && pmSel.anchor === selFrom && pmSel.head === selTo) return;
    const tr = this.view.state.tr;
    update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
      if (text.length > 0) tr.replaceWith(offset + fromA, offset + toA, this.view.state.schema.text(text.toString()));
      else tr.delete(offset + fromA, offset + toA);
      offset += toB - fromB - (toA - fromA);
    });
    tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo));
    this.view.dispatch(tr);
  }

  setSelection(anchor: number, head: number) {
    this.cm.focus();
    this.updating = true;
    this.cm.dispatch({ selection: { anchor, head } });
    this.updating = false;
  }

  // The outer editor's keys for a code block, which CodeMirror now receives first: Shift+Enter leaves it (enter-keys.ts
  // newBlock), Arrow Down at the end of the last block starts a line below (menus.ts leaveLastCode), and the arrows at
  // its edges move into the blocks around it (the ProseMirror example's maybeEscape). Undo and redo are the outer
  // editor's, so one history holds both.
  private codeMirrorKeymap(): KeyBinding[] {
    const view = this.view;
    const leave = () => {
      if (!exitCode(view.state, view.dispatch)) return false;
      view.focus();
      return true;
    };
    return [
      { key: "ArrowUp", run: () => this.maybeEscape("line", -1) },
      { key: "ArrowLeft", run: () => this.maybeEscape("char", -1) },
      { key: "ArrowDown", run: () => (this.atEndOfLastBlock() && leave()) || this.maybeEscape("line", 1) },
      { key: "ArrowRight", run: () => this.maybeEscape("char", 1) },
      { key: "Shift-Enter", run: leave },
      { key: "Mod-Enter", run: leave },
      { key: "Mod-z", run: () => undo(view.state, view.dispatch) },
      { key: "Shift-Mod-z", run: () => redo(view.state, view.dispatch) },
      { key: "Mod-y", run: () => redo(view.state, view.dispatch) },
    ];
  }

  /**
   * The keys that move a block past its neighbour (menus.ts moveKeys, Mod-Shift-ArrowUp and Mod-Shift-ArrowDown) are
   * the outer editor's, so the code block moves with the caret in it (Codex on #2003). The key goes to its keymaps as
   * pressed, and the outer editor's focus puts the caret back in the moved block's code.
   */
  private outerKey(event: KeyboardEvent): boolean {
    const move = event.shiftKey && (event.ctrlKey || event.metaKey) && /^Arrow(Up|Down)$/.test(event.key);
    if (!move || !this.view.someProp("handleKeyDown", (handle) => handle(this.view, event))) return false;
    event.preventDefault();
    this.view.focus();
    return true;
  }

  /** The caret at the end of the code, and nothing below the block. */
  private atEndOfLastBlock(): boolean {
    const { main } = this.cm.state.selection;
    const pos = this.getPos();
    if (!main.empty || main.head < this.cm.state.doc.length || pos === undefined) return false;
    return pos + this.node.nodeSize === this.view.state.doc.content.size;
  }

  /**
   * Whether an arrow up or down still has a row of code to go to: on a wrapped line the next row is the same line, so
   * the visual rows are compared (Codex on #2003). CodeMirror's moveVertically goes to the code's start or end from
   * its top or bottom row, which stays on that row.
   */
  private canMoveVertically(dir: -1 | 1): boolean {
    const { main } = this.cm.state.selection;
    const moved = this.cm.moveVertically(main, dir > 0);
    if (moved.head === main.head) return false;
    const at = this.cm.coordsAtPos(main.head);
    const to = this.cm.coordsAtPos(moved.head);
    return at === null || to === null || at.top !== to.top;
  }

  private maybeEscape(unit: "line" | "char", dir: -1 | 1): boolean {
    const { state } = this.cm;
    const main = state.selection.main;
    if (!main.empty) return false;
    if (unit === "char" ? (dir < 0 ? main.from > 0 : main.to < state.doc.length) : this.canMoveVertically(dir)) {
      return false;
    }
    const pos = this.getPos();
    if (pos === undefined) return false;
    const target = pos + (dir < 0 ? 0 : this.node.nodeSize);
    const selection = Selection.near(this.view.state.doc.resolve(target), dir);
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView());
    this.view.focus();
    return true;
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const language = String(node.attrs.language ?? "");
    if (this.languageField.value !== language && document.activeElement !== this.languageField) {
      this.languageField.value = language;
    }
    this.loadLanguage(language);
    this.drawPreview();
    if (this.updating) return true;
    const newText = node.textContent;
    const curText = this.cm.state.doc.toString();
    if (newText === curText) return true;
    let start = 0;
    let curEnd = curText.length;
    let newEnd = newText.length;
    while (start < curEnd && curText.charCodeAt(start) === newText.charCodeAt(start)) start += 1;
    while (curEnd > start && newEnd > start && curText.charCodeAt(curEnd - 1) === newText.charCodeAt(newEnd - 1)) {
      curEnd -= 1;
      newEnd -= 1;
    }
    this.updating = true;
    this.cm.dispatch({ changes: { from: start, to: curEnd, insert: newText.slice(start, newEnd) } });
    this.updating = false;
    return true;
  }

  selectNode() {
    this.cm.focus();
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.cm.destroy();
    this.mathHold.close();
    if (this.copyIcon !== undefined) void unmount(this.copyIcon);
  }
}

/** The code_block node drawn as CodeMirror, coloured within the page's limits (`undefined`: never coloured). */
export const codeBlockView = (limits: CodeColourLimits | undefined) =>
  $view(codeBlockSchema.node, () => (node, view, getPos) => new CodeBlockView(node, view, getPos, limits));
