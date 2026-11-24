// Math in the Text editor, on the pieces Milkdown's Crepe 7.23.0 builds its own from (src/feature/latex: remark.ts,
// inline-latex.ts, input-rule.ts, command.ts), without its drawing: Crepe draws with katex.render into the page, whose
// HTML carries style attributes the app's CSP refuses. Here a formula is drawn as the page draws it (lib/profile/
// math.ts: KaTeX's MathML, only the elements and attributes that shape a formula), each element made with
// createElementNS and each string a text node, so nothing in a formula is ever read as HTML. KaTeX loads with the first
// formula, not with the editor.
//
// remark-math 6.0.0 reads and writes the dollars (micromark-extension-math 3.1.0, mdast-util-math 3.0.0), as the page
// reads them (parse.ts). Two steps after it, as Crepe's: math between single dollars that the page's rule keeps as words
// (math-syntax.ts, "$5 and $10") goes back to the words it was written as, and a `$$` block becomes a code block whose
// language is "math", edited in CodeMirror (code-block.ts), which shows the drawn formula below the TeX. Such a block
// is written back as `$$`. A ```math fence means the same to the page (parse.ts isMathFence), so it is written as `$$`
// too. Crepe uses the language "LaTeX", which would turn a ```latex code sample into math; "math" is GitHub's.
// mdast-util-math writes every dollar that is a word with a backslash before it, so "$5" is saved as "\$5", which the
// page shows as "$5".

import type { Editor } from "@milkdown/core";
import { codeBlockSchema } from "@milkdown/preset-commonmark";
import { nodeRule } from "@milkdown/prose";
import { textblockTypeInputRule } from "@milkdown/prose/inputrules";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { type EditorState, NodeSelection, TextSelection } from "@milkdown/prose/state";
import type { NodeView } from "@milkdown/prose/view";
import { $command, $inputRule, $nodeSchema, $remark, $view } from "@milkdown/utils";
import remarkMath from "remark-math";
import type { MathNode } from "../profile/math.ts";
import { isInlineMath } from "../profile/math-syntax.ts";

export const MATH_LANGUAGE = "math";
/** Milkdown's context, as Editor.config hands it over (menus.ts names it the same way). */
type Ctx = Parameters<Parameters<Editor["config"]>[0]>[0];
const MATHML = "http://www.w3.org/1998/Math/MathML";

/** The parts of a Markdown tree (mdast) the reading step changes. */
type MdNode = {
  type: string;
  value?: string;
  lang?: string | null;
  meta?: string | null;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** Single-dollar math the page reads as words goes back to its words; a `$$` block becomes a math code block. */
function readAsPage(node: MdNode, source: string) {
  for (const [index, child] of (node.children ?? []).entries()) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (child.type === "inlineMath" && start !== undefined && end !== undefined) {
      const raw = source.slice(start, end);
      if (!isInlineMath(raw, source[end] ?? "")) node.children?.splice(index, 1, { type: "text", value: raw });
    } else if (child.type === "math") {
      node.children?.splice(index, 1, { type: "code", lang: MATH_LANGUAGE, meta: null, value: child.value ?? "" });
    } else readAsPage(child, source);
  }
}

const mathSyntax = $remark("remarkMath", () => remarkMath);
const mathAsPage = $remark("mathAsPage", () => () => (tree: MdNode, file: { value: unknown }) => {
  readAsPage(tree, String(file.value));
});

/** A formula in a line: an atom holding its TeX (Crepe's math_inline), written back between dollars. */
export const mathInlineSchema = $nodeSchema("math_inline", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: { value: { default: "" } },
  parseDOM: [
    {
      tag: "span[data-math-inline]",
      getAttrs: (dom: HTMLElement) => ({ value: dom.dataset.value ?? dom.textContent ?? "" }),
    },
  ],
  toDOM: (node) => [
    "span",
    { "data-math-inline": "", "data-value": String(node.attrs.value) },
    String(node.attrs.value),
  ],
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? "") });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_inline",
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, String(node.attrs.value));
    },
  },
}));

/** Whether the selection is one formula in a line. */
export function isMathSelected(state: EditorState): boolean {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === "math_inline";
}

/** Selected words become a formula; a selected formula goes back to its TeX, selected (Crepe toggleLatexCommand). */
export const toggleMathCommand = $command("ToggleInlineMath", (ctx) => () => (state, dispatch) => {
  const { selection, schema } = state;
  if (isMathSelected(state)) {
    const value = String((selection as NodeSelection).node.attrs.value);
    if (value === "") return false;
    const tr = state.tr.replaceSelectionWith(schema.text(value), false);
    dispatch?.(tr.setSelection(TextSelection.create(tr.doc, selection.from, selection.from + value.length)));
    return true;
  }
  const value = state.doc.textBetween(selection.from, selection.to);
  if (selection.empty || value.trim() === "" || !(selection instanceof TextSelection)) return false;
  dispatch?.(state.tr.replaceSelectionWith(mathInlineSchema.type(ctx).create({ value })));
  return true;
});

/** `$x$` typed makes a formula (Crepe input-rule.ts); `$$` and a space at a line's start makes a math block. */
const inlineMathRule = $inputRule((ctx) =>
  nodeRule(/(?:^|[^$])(\$([^\s$](?:[^$]*[^\s$])?)\$)$/, mathInlineSchema.type(ctx), {
    getAttr: (match) => ({ value: match[2] ?? "" }),
    updateCaptured: ({ fullMatch, start }) =>
      fullMatch.startsWith("$") ? {} : { fullMatch: fullMatch.slice(1), start: start + 1 },
  }),
);
const mathBlockRule = $inputRule((ctx) =>
  textblockTypeInputRule(/^\$\$\s$/, codeBlockSchema.type(ctx), () => ({ language: MATH_LANGUAGE })),
);

/** The formula drawn as MathML elements, each attribute already one math.ts keeps. */
export function mathElement(tree: MathNode): Element {
  const element = document.createElementNS(MATHML, tree.name);
  for (const [name, value] of Object.entries(tree.attrs)) element.setAttribute(name, value);
  for (const child of tree.children) {
    element.append(typeof child === "string" ? document.createTextNode(child) : mathElement(child));
  }
  return element;
}

/** Draws `tex` into `into` once KaTeX has loaded, or its TeX between dollars when it cannot be drawn. */
export async function drawInto(into: HTMLElement, tex: string, display: boolean, isCurrent: () => boolean) {
  const { drawMath, mathBudget } = await import("../profile/math.ts");
  if (!isCurrent()) return;
  const tree = drawMath(tex, display, mathBudget());
  into.replaceChildren(tree === null ? document.createTextNode(display ? tex : `$${tex}$`) : mathElement(tree));
}

/** A formula in a line, shown drawn; its TeX shows while KaTeX loads. */
class MathInlineView implements NodeView {
  readonly dom: HTMLElement;
  private drawn = "";

  constructor(node: ProseNode) {
    this.dom = document.createElement("span");
    this.dom.dataset.mathInline = "";
    this.dom.className = "inline-block max-w-full contain-paint";
    this.draw(node);
  }

  private draw(node: ProseNode) {
    const tex = String(node.attrs.value);
    if (tex === this.drawn) return;
    this.drawn = tex;
    this.dom.textContent = `$${tex}$`;
    void drawInto(this.dom, tex, false, () => this.drawn === tex);
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== "math_inline") return false;
    this.draw(node);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

const mathInlineView = $view(mathInlineSchema.node, () => (node) => new MathInlineView(node));

/** A code block whose language is "math" is written as `$$`; every other one as Milkdown writes it. */
export function writeMathBlocksAsDollars(ctx: Ctx) {
  ctx.update(codeBlockSchema.key, (prev) => (schemaCtx) => {
    const schema = prev(schemaCtx);
    return {
      ...schema,
      toMarkdown: {
        ...schema.toMarkdown,
        runner: (state, node) => {
          if (node.attrs.language === MATH_LANGUAGE)
            state.addNode("math", undefined, node.content.firstChild?.text ?? "");
          else schema.toMarkdown.runner(state, node);
        },
      },
    };
  });
}

/** Everything math adds to the editor, used after the presets, with writeMathBlocksAsDollars in its config. */
export const math = [
  mathSyntax,
  mathAsPage,
  mathInlineSchema,
  mathInlineView,
  toggleMathCommand,
  inlineMathRule,
  mathBlockRule,
].flat();
