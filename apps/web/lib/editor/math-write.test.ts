// Codex on #2020: two formulas side by side in the editor were saved as "$x$$y$", which micromark-extension-math 3.1.0
// reads as one formula "x$$y" (a closing run must be as long as the opening one), so the card showed its source.
import { expect, test } from "vitest";
import { parseReadme } from "../profile/parse.ts";
import { type InlineFormula, writeFormulaRun } from "./math-write.ts";

type Phrase = InlineFormula | { readonly type: "text"; readonly value: string };

const formula = (value: string): InlineFormula => ({ type: "inlineMath", value });
const words = (value: string): Phrase => ({ type: "text", value });
/** mdast-util-math 3.0.0's writer for these values: the fewest dollars that occur in none, one here. */
const single = (node: InlineFormula) => `$${node.value}$`;
const written = (children: Phrase[]) =>
  children.map((node) => (node.type === "inlineMath" ? writeFormulaRun(node, children, single) : node.value));

test("formulas side by side are written as one, so the page reads them as math and not as their source", () => {
  const children = [words("a "), formula("x"), formula("\\alpha"), formula("y"), words(" b")];
  expect(written(children)).toEqual(["a ", "$$x \\alpha y$$", "", "", " b"]);
  const [paragraph] = parseReadme(written(children).join(""));
  const kinds = paragraph?.kind === "paragraph" ? paragraph.children.map((inline) => inline.kind) : [];
  expect(kinds).toEqual(["text", "math", "text"]);
});

test("a formula with words beside it is written by mdast-util-math's writer as it was", () => {
  expect(written([formula("x"), words(" and "), formula("y")])).toEqual(["$x$", " and ", "$y$"]);
});
