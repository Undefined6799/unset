// Code colours, one list for the editor and the page (P1.21v; Alex 2026-11-23: "public page colours by class on the
// server"). Each group of Lezer highlight tags gets a class `code-<name>` and a theme variable `--code-<name>`
// (shared/ui/theme.css): the page draws the class with apps/web/app.css, the editor's CodeMirror with the same
// variable (code-block.ts), so light, dark and every change follow the one theme file.
//
// colourCode runs on the server for the page: CodeMirror's own language list finds the parser by name or alias
// (@codemirror/language 6.13.1 LanguageDescription.matchLanguageName), and @lezer/highlight 1.2.5 highlightCode walks
// the tree. A name the list does not know loads nothing, so the member's text never picks a module to import. The runs
// are plain strings the component draws as text; nothing here makes markup.
//
// The parse is bounded (review of #2004 at e36de8a: one Textile line of "<a " took 182 s, synchronously, in the page
// load). Measured on the pinned parsers (@codemirror/language-data 6.5.2, legacy-modes 6.5.5; Node 26.12), with 19
// hostile shapes of 20,000 characters in each of the 136 languages:
// - Lezer's LR parsers take one small step per advance(), at most about 35 ms, whatever the lines.
// - A stream parser takes whole lines per step, about 512 characters' worth, and some of its patterns grow faster than
//   the line: one line of 20,000 took 94 s in Textile and 8.9 s in Erlang. With lines of at most 400 characters the
//   longest step was 31 ms (CoffeeScript); at 1,000 it was 101 ms (TiddlyWiki).
// - Markdown's parser takes a whole paragraph per step, 390 ms for 20,000 characters of "*_", so it stays plain.
// - Scala, Kotlin and Dart's nested comment recurses once per "/*" (legacy-modes clike.js:523) and throws on a long run.
// So a block is coloured only within CodeColourLimits, parse steps stop at a deadline, and any throw is plain text.
import { type Language, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightCode, type Tag, tagHighlighter, tags } from "@lezer/highlight";

type Parser = Language["parser"];
type Tree = Parameters<typeof highlightCode>[1];

/** The colour groups; `name` is the class and variable suffix. Comments are also set in italics. */
export const CODE_COLOURS: readonly { readonly name: string; readonly tags: readonly Tag[] }[] = [
  { name: "keyword", tags: [tags.keyword, tags.operatorKeyword, tags.modifier] },
  { name: "string", tags: [tags.string, tags.regexp, tags.special(tags.string)] },
  { name: "number", tags: [tags.number, tags.bool, tags.null, tags.atom] },
  { name: "comment", tags: [tags.comment, tags.meta] },
  { name: "type", tags: [tags.typeName, tags.className, tags.namespace] },
  { name: "function", tags: [tags.function(tags.variableName), tags.function(tags.propertyName)] },
  { name: "tag", tags: [tags.tagName, tags.angleBracket] },
  { name: "attribute", tags: [tags.attributeName, tags.propertyName] },
  { name: "invalid", tags: [tags.invalid] },
];

/** Gives each highlighted node its group's class; the editor and the page both use it. */
export const codeHighlighter = tagHighlighter(
  CODE_COLOURS.map(({ name, tags: group }) => ({ tag: [...group], class: `code-${name}` })),
);

/** A stretch of code and its colour class, "" for uncoloured text. */
export type CodeRun = { readonly text: string; readonly colour: string };

/**
 * How much colouring one page may do (interfaces/web limits.ts CODE_COLOUR_LIMITS). A block longer than `chars`, or
 * with a line longer than `lineChars`, stays plain: some parsers take a whole line, or a whole Markdown paragraph, in
 * one step, so these two bound the longest step. `blockMs` and `pageMs` bound the steps' total; past either the block
 * stays plain.
 */
export type CodeColourLimits = {
  readonly chars: number;
  readonly lineChars: number;
  readonly blockMs: number;
  readonly pageMs: number;
};

/** One page's colouring time, shared by all its code blocks. */
export type CodeColourBudget = { readonly limits: CodeColourLimits; spentMs: number };

export const codeColourBudget = (limits: CodeColourLimits): CodeColourBudget => ({ limits, spentMs: 0 });

/**
 * Why a block stays plain: no language CodeMirror knows (or one in PLAIN), past the size limits, out of time, or a
 * parser or module load that threw. The page shows each the same way, as plain text; the reason is for tests.
 */
export type PlainReason = "language" | "size" | "time" | "error";
export type Colouring = { readonly runs: readonly CodeRun[] } | { readonly plain: PlainReason };

/** The code as coloured runs that join back to `text`, or why it stays plain. */
export async function colourCode(text: string, language: string, budget: CodeColourBudget): Promise<Colouring> {
  if (!withinSize(text, budget.limits)) return { plain: "size" };
  const found = language === "" ? null : LanguageDescription.matchLanguageName(languages, language, true);
  if (found === null || PLAIN.has(found.name)) return { plain: "language" };
  let parser: Parser;
  try {
    parser = (await found.load()).language.parser;
  } catch {
    return { plain: "error" };
  }
  const started = performance.now();
  try {
    const tree = parseWithin(parser, text, Math.min(budget.limits.blockMs, budget.limits.pageMs - budget.spentMs));
    return tree === null ? { plain: "time" } : { runs: runsOf(text, tree) };
  } catch {
    // A parser bug on this input, such as the nested comment's stack overflow above: the block stays plain.
    return { plain: "error" };
  } finally {
    budget.spentMs += performance.now() - started;
  }
}

/** Languages whose parser takes a step no line limit bounds (see the top of this file): their code stays plain. */
const PLAIN: ReadonlySet<string> = new Set(["Markdown"]);

/** Every language's name, for the sweep that holds each one to the limits (limits.code.test.ts in interfaces/web). */
export const CODE_LANGUAGES: readonly string[] = languages.map(({ name }) => name);

function withinSize(text: string, limits: CodeColourLimits): boolean {
  if (text.length > limits.chars) return false;
  return text.split("\n").every((line) => line.length <= limits.lineChars);
}

/**
 * Parses step by step (@lezer/common 1.5.5 PartialParse.advance) and gives up once `ms` have passed: an LR parser's
 * step moves each of its stacks past one position (@lezer/lr 1.4.12 dist/index.js:1296), a stream parser's takes about
 * 512 characters of whole lines (@codemirror/language 6.13.1 dist/index.js:2186). Nothing yields between steps: the parse runs inside the page load,
 * and the limits keep it short.
 */
function parseWithin(parser: Parser, text: string, ms: number): Tree | null {
  const deadline = performance.now() + ms;
  const parse = parser.startParse(text);
  for (;;) {
    if (performance.now() >= deadline) return null;
    const tree = parse.advance();
    if (tree !== null) return tree;
  }
}

/** The tree's runs, with neighbours of one colour joined, line ends included, so the page's data stays small. */
function runsOf(text: string, tree: Tree): CodeRun[] {
  const runs: { text: string; colour: string }[] = [];
  const put = (piece: string, colour: string) => {
    const last = runs.at(-1);
    if (last?.colour === colour) last.text += piece;
    else runs.push({ text: piece, colour });
  };
  highlightCode(text, tree, codeHighlighter, put, () => put("\n", ""));
  return runs;
}
