// Code colours, one list for the editor and the page (P1.21v; Alex 2026-11-23: "public page colours by class on the
// server"). Each group of Lezer highlight tags gets a class `code-<name>` and a theme variable `--code-<name>`
// (shared/ui/theme.css): the page draws the class with apps/web/app.css, the editor's CodeMirror with the same
// variable (code-block.ts), so light, dark and every change follow the one theme file.
//
// colourCode runs on the server for the page: CodeMirror's own language list finds the parser by name or alias
// (@codemirror/language 6.13.1 LanguageDescription.matchLanguageName), and @lezer/highlight 1.2.5 highlightCode walks
// the tree. A name the list does not know loads nothing, so the member's text never picks a module to import. The runs
// are plain strings the component draws as text; nothing here makes markup.
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightCode, type Tag, tagHighlighter, tags } from "@lezer/highlight";

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

/** The code as coloured runs that join back to `text`, or null when the language is none CodeMirror knows. */
export async function colourCode(text: string, language: string): Promise<readonly CodeRun[] | null> {
  const found = language === "" ? null : LanguageDescription.matchLanguageName(languages, language, true);
  if (found === null) return null;
  const { language: parser } = await found.load();
  const runs: CodeRun[] = [];
  highlightCode(
    text,
    parser.parser.parse(text),
    codeHighlighter,
    (piece, colour) => runs.push({ text: piece, colour }),
    () => runs.push({ text: "\n", colour: "" }),
  );
  return runs;
}
