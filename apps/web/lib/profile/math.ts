// Math in a Text card, in GitHub's syntax (Alex 2026-11-22 00:34Z, "Keep math, GitHub style"; ADR 0110 lets a reader
// draw math its own way): drawn on the server as MathML, which Chromium, Firefox and Safari draw themselves (MathML
// Core, https://www.w3.org/TR/mathml-core/), so the page needs no math script, stylesheet or font, and no style
// attribute reaches the CSP.
//
// KaTeX 0.16.47 reads the TeX (`output: "mathml"`; node_modules/katex/src/Settings.ts for every option below). It
// gives a string, and a string never reaches the page: parse5 8.0.1 reads it back into nodes, and only the MathML
// elements KaTeX makes (src/mathMLTree.ts MathNodeType) with the attributes that shape a formula are kept, each value
// a plain word or length. Text is text: readme.svelte draws each string as an escaped text node. So whatever KaTeX
// would let through, a formula cannot make a link, load a picture, colour or style the page, or hide text by colour.
//
// Settings: `trust: false` refuses \href, \url, \includegraphics and the \html commands (they show as red source,
// whose colour is dropped here); `maxExpand` stops macros that expand without end, and `maxSize` caps every size a
// formula sets, in ems; `strict: "ignore"` keeps KaTeX from writing member text to the console; `throwOnError` makes
// a formula it cannot read an error, shown by the caller as the source it is. No `macros` object is passed, so each
// formula starts from KaTeX's own macros and none can define one for another.
import katex from "katex";
import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";
import { MAX_TEX_CHARS } from "./math-syntax.ts";

/** A MathML element as the page draws it; every string child is text. */
export type MathNode = {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly (MathNode | string)[];
};

/** What is left for one card's math: formulas to draw and MathML elements to make. */
export type MathBudget = { formulas: number; nodes: number };

/** A card's formulas past this many are shown as their source. */
const MAX_FORMULAS = 200;
/** A card's MathML elements, all formulas together; a 5,000-character matrix alone makes about 15,000. */
const MAX_NODES = 20_000;

export const mathBudget = (): MathBudget => ({ formulas: MAX_FORMULAS, nodes: MAX_NODES });

const MATHML = "http://www.w3.org/1998/Math/MathML";

/** The elements KaTeX 0.16.47 makes (src/mathMLTree.ts), less semantics and annotation (unwrapped) and mglyph. */
export const MATH_ELEMENTS: ReadonlySet<string> = new Set([
  "math",
  "mi",
  "mn",
  "mo",
  "mtext",
  "mspace",
  "mrow",
  "mfrac",
  "msqrt",
  "mroot",
  "msub",
  "msup",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mlabeledtr",
  "menclose",
  "mstyle",
  "mpadded",
  "mphantom",
]);

/**
 * The attributes KaTeX sets that shape a formula (src/ setAttribute calls). Left out: style, mathcolor and
 * mathbackground (colour), href, src and alt (links and pictures), xmlns (the page sets it), encoding, linebreak.
 */
export const MATH_ATTRIBUTES: ReadonlySet<string> = new Set([
  "display",
  "mathvariant",
  "mathsize",
  "fence",
  "separator",
  "stretchy",
  "largeop",
  "accent",
  "accentunder",
  "lspace",
  "rspace",
  "minsize",
  "maxsize",
  "width",
  "height",
  "depth",
  "linethickness",
  "displaystyle",
  "scriptlevel",
  "notation",
  "columnalign",
  "columnlines",
  "columnspacing",
  "rowlines",
  "rowspacing",
]);

/**
 * The attributes that take a length, or a list of lengths (MathML Core, "Length values"). Each must be a size of
 * zero or more in a fixed unit, so no formula pulls its text back over what is beside it or out of its own box:
 * no minus sign, and no pseudo-unit such as "1width" that counts in another part's size (review of #2019 at d1f2a98,
 * where nested \raisebox lifted text over the page's header; voffset, which only moves text, is not kept at all).
 */
const LENGTHS: ReadonlySet<string> = new Set([
  "lspace",
  "rspace",
  "minsize",
  "maxsize",
  "mathsize",
  "width",
  "height",
  "depth",
  "linethickness",
  "columnspacing",
  "rowspacing",
]);
const LENGTH = /^\+?(?:\d{1,6}(?:\.\d{1,6})?|\.\d{1,6})(?:em|ex|pt|px|mu)?$/;
/** A font as KaTeX names one (src/buildMathML.ts getVariant): words joined by hyphens. */
const VARIANT = /^[a-z]{1,16}(?:-[a-z]{1,16}){0,3}$/;
/** Any other attribute: words or whole numbers, nothing that could name a place, a colour or a rule. */
const WORDS = /^[A-Za-z0-9 ]{0,64}$/;

function plainValue(name: string, value: string): boolean {
  if (name === "mathvariant") return VARIANT.test(value);
  if (!LENGTHS.has(name)) return WORDS.test(value);
  const parts = value.split(" ");
  return parts.length <= 64 && parts.every((part) => LENGTH.test(part));
}

const SETTINGS = {
  output: "mathml",
  throwOnError: true,
  trust: false,
  strict: "ignore",
  maxSize: 10,
  maxExpand: 100,
} as const;

type Parsed = DefaultTreeAdapterTypes.ChildNode;

/** The first MathML math element under `nodes`, depth first. */
function findMath(nodes: readonly Parsed[]): Parsed | undefined {
  for (const node of nodes) {
    if (!("tagName" in node)) continue;
    if (node.tagName === "math" && node.namespaceURI === MATHML) return node;
    const inner = findMath(node.childNodes);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/**
 * The kept nodes for `node`: an allowed element with its allowed attributes, the children of one that is not, or its
 * text. Counts each element against `left`; null once it runs out.
 */
function keep(node: Parsed, left: { nodes: number }): (MathNode | string)[] | null {
  if (node.nodeName === "#text" && "value" in node) return [node.value];
  if (!("tagName" in node) || node.namespaceURI !== MATHML) return [];
  if (node.tagName === "annotation" || node.tagName === "mglyph") return [];
  const children: (MathNode | string)[] = [];
  for (const child of node.childNodes) {
    const kept = keep(child, left);
    if (kept === null) return null;
    children.push(...kept);
  }
  if (!MATH_ELEMENTS.has(node.tagName)) return children;
  left.nodes -= 1;
  if (left.nodes < 0) return null;
  const attrs: Record<string, string> = {};
  for (const { name, value } of node.attrs) {
    if (MATH_ATTRIBUTES.has(name) && plainValue(name, value)) attrs[name] = value;
  }
  return [{ name: node.tagName, attrs, children }];
}

/**
 * The formula `tex` as MathML, a display formula when `display` is set, taken from `budget`; null when it is too long,
 * KaTeX cannot read it, or the card's budget has run out, and the caller shows the source instead.
 */
export function drawMath(tex: string, display: boolean, budget: MathBudget): MathNode | null {
  if (tex.length > MAX_TEX_CHARS || budget.formulas <= 0) return null;
  budget.formulas -= 1;
  let markup: string;
  try {
    markup = katex.renderToString(tex, { ...SETTINGS, displayMode: display });
  } catch {
    // A KaTeX ParseError, or a RangeError from a formula nested past the stack: both are the member's text.
    return null;
  }
  const math = findMath(parseFragment(markup).childNodes);
  const left = { nodes: budget.nodes };
  const kept = math === undefined ? null : keep(math, left);
  const root = kept?.[0];
  if (root === undefined || typeof root === "string") return null;
  budget.nodes = left.nodes;
  return root;
}
