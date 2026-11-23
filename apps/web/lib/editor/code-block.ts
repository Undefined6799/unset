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
// input's value, and the Copy button writes plain text to the clipboard.

import { defaultKeymap } from "@codemirror/commands";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment } from "@codemirror/state";
import { EditorView as CodeMirror, drawSelection, type KeyBinding, keymap, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { codeBlockSchema } from "@milkdown/preset-commonmark";
import { exitCode } from "@milkdown/prose/commands";
import { redo, undo } from "@milkdown/prose/history";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { Selection, TextSelection } from "@milkdown/prose/state";
import type { EditorView, NodeView } from "@milkdown/prose/view";
import { $view } from "@milkdown/utils";

/** CodeMirror's look, drawn from the theme's colours (custom properties reach into the shadow root). */
const look = CodeMirror.theme({
  "&": { color: "var(--foreground)", backgroundColor: "transparent", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "var(--font-mono)", lineHeight: "20px", caretColor: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "inherit" },
});

// Code colours that read in both themes: light-dark() follows the page's color-scheme, which the shadow root inherits.
// CodeMirror's defaultHighlightStyle is drawn for a light background only.
const colours = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "light-dark(#7a1fa2, #d7a6f2)" },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: "light-dark(#1d6b2f, #9bd7a4)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "light-dark(#a04a00, #f2b77e)" },
  { tag: [tags.comment, tags.meta], color: "light-dark(#5a575b, #a19ea2)", fontStyle: "italic" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "light-dark(#0b5f8a, #8fcbea)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "light-dark(#2a4fb8, #a8bcf5)" },
  { tag: [tags.tagName, tags.angleBracket], color: "light-dark(#a3143c, #f29bb3)" },
  { tag: [tags.attributeName, tags.propertyName], color: "light-dark(#6b4c00, #e6cf8a)" },
  { tag: tags.invalid, color: "light-dark(#b00020, #ff8a9a)" },
]);

class CodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  private readonly cm: CodeMirror;
  private readonly language = new Compartment();
  private readonly languageField: HTMLInputElement;
  private loaded = "";
  private updating = false;

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
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
        syntaxHighlighting(colours),
        CodeMirror.lineWrapping,
        look,
        this.language.of([]),
        CodeMirror.updateListener.of((update) => this.forwardUpdate(update)),
      ],
    });
    this.dom.append(tools, host);
    this.loadLanguage(String(node.attrs.language ?? ""));
  }

  private languageInput(): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "h-7 w-40 rounded-md border border-input bg-background px-2 font-mono text-xs";
    input.setAttribute("aria-label", "Code language");
    input.placeholder = "Language";
    input.value = String(this.node.attrs.language ?? "");
    input.addEventListener("change", () => this.setLanguage(input.value.trim()));
    return input;
  }

  private copyButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "h-7 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent";
    button.textContent = "Copy";
    button.addEventListener("click", () => {
      void navigator.clipboard?.writeText(this.cm.state.doc.toString());
    });
    return button;
  }

  private setLanguage(language: string) {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, "language", language));
  }

  /** Loads the language CodeMirror knows by that name or alias; an unknown name shows plain text. */
  private loadLanguage(name: string) {
    if (name === this.loaded) return;
    this.loaded = name;
    const found = LanguageDescription.matchLanguageName(languages, name, true);
    if (found === null) {
      this.cm.dispatch({ effects: this.language.reconfigure([]) });
      return;
    }
    void found.load().then((support) => {
      if (this.loaded === name) this.cm.dispatch({ effects: this.language.reconfigure(support) });
    });
  }

  private forwardUpdate(update: ViewUpdate) {
    const pos = this.getPos();
    if (this.updating || !this.cm.hasFocus || pos === undefined) return;
    let offset = pos + 1;
    const { main } = update.state.selection;
    const selFrom = offset + main.from;
    const selTo = offset + main.to;
    const pmSel = this.view.state.selection;
    if (!update.docChanged && pmSel.from === selFrom && pmSel.to === selTo) return;
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

  /** The caret at the end of the code, and nothing below the block. */
  private atEndOfLastBlock(): boolean {
    const { main } = this.cm.state.selection;
    const pos = this.getPos();
    if (!main.empty || main.head < this.cm.state.doc.length || pos === undefined) return false;
    return pos + this.node.nodeSize === this.view.state.doc.content.size;
  }

  private maybeEscape(unit: "line" | "char", dir: -1 | 1): boolean {
    const { state } = this.cm;
    const main = state.selection.main;
    if (!main.empty) return false;
    const range = unit === "line" ? state.doc.lineAt(main.head) : main;
    if (dir < 0 ? range.from > 0 : range.to < state.doc.length) return false;
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
  }
}

/** The code_block node drawn as CodeMirror. */
export const codeBlockView = $view(
  codeBlockSchema.node,
  () => (node, view, getPos) => new CodeBlockView(node, view, getPos),
);
