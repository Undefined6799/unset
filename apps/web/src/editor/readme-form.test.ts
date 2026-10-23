// The README form's starting document (ADR 0037 point 5): the page's textarea holds BlockNote JSON the server wrote;
// anything else starts an empty editor rather than failing.
import { expect, test } from "vitest";
import { initialDocument } from "./readme-form.tsx";

test("initial_document_reads_a_block_array", () => {
  expect(initialDocument('[{"type":"paragraph","content":"Hi"}]')).toEqual([{ type: "paragraph", content: "Hi" }]);
});

test("initial_document_is_empty_for_anything_else", () => {
  expect(initialDocument("")).toEqual([]);
  expect(initialDocument("{not json")).toEqual([]);
  expect(initialDocument('{"type":"paragraph"}')).toEqual([]);
});
