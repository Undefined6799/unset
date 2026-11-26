// The public repository's docs and sample records stay equal to the schemas (ADR 0089). A failure here means a schema
// changed without its documentation: run `npm run docs -w shared/lexicons`, then reread the words around the tables.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { type RecordNsid, validateRecord } from "../src/validate.ts";
import { docsProblems, fill, PUBLIC, readSchemas, reference } from "./public-docs.ts";

const schemas = readSchemas();
const RECORDS: readonly RecordNsid[] = ["sh.unset.profile", "sh.unset.page", "sh.unset.card"];

type Sample = { file: string; nsid: string; value: unknown };

/** Every sample record. Its folder spells the record type: examples/sh/unset/card/text.json is a sh.unset.card. */
function samples(root = PUBLIC): Sample[] {
  const dir = join(root, "examples");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const parts = relative(dir, join(dir, name)).split(sep);
      return {
        file: ["examples", ...parts].join("/"),
        nsid: parts.slice(0, -1).join("."),
        value: JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown,
      };
    });
}

/** Every `$type` anywhere in a value. */
function typesIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(typesIn);
  if (typeof value !== "object" || value === null) return [];
  const own = "$type" in value && typeof value.$type === "string" ? [value.$type] : [];
  return [...own, ...Object.values(value).flatMap(typesIn)];
}

const copies: string[] = [];
/** A copy of the public tree that a test may change. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "unset-public-docs-"));
  copies.push(root);
  cpSync(PUBLIC, root, { recursive: true });
  return root;
}
afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true });
});

describe("public lexicon docs", () => {
  test("every_sample_is_a_valid_record_as_we_write_them", () => {
    const found = samples();
    expect(new Set(found.map((s) => s.nsid))).toEqual(new Set(RECORDS));
    for (const sample of found) {
      const nsid = RECORDS.find((record) => record === sample.nsid);
      expect(nsid, sample.file).toBeDefined();
      if (nsid) expect(validateRecord(nsid, sample.value, "write"), sample.file).toMatchObject({ ok: true });
    }
  });

  test("every_record_and_block_of_ours_has_a_sample", () => {
    const used = new Set(samples().flatMap((s) => typesIn(s.value)));
    const shown = schemas.filter(({ defs }) => defs.main?.type === "record" || defs.main?.type === "object");
    expect(shown.map((s) => s.nsid).filter((nsid) => !used.has(nsid))).toEqual([]);
  });

  test("the_docs_match_the_schemas_and_document_every_definition", () => {
    expect(docsProblems(schemas)).toEqual([]);
  });

  test("a_table_gives_the_record_key_type_requirement_and_limits", () => {
    const card = reference("sh.unset.card", "main", schemas) ?? "";
    expect(card).toMatch(/^Record key: `tid`\n\n\| Property \| Type \| Required \| Limits \| Description \|/);
    expect(card).toMatch(/\| `content` \| open union of `sh\.unset\.block\.text`, .* \| Yes \|/);
    expect(reference("sh.unset.page", "main", schemas)).toMatch(
      /\| `cards` \| array of `#cardRef` \| No \| up to 100 items \|/,
    );
    expect(reference("sh.unset.profile", "main", schemas)).toMatch(/\| `avatar` \| blob \| No \| `image\/\*`; up to/);
    expect(reference("sh.unset.authFull", "main", schemas)).toContain(
      "| `sh.unset.page` | Records: create, update, delete |",
    );
    expect(reference("sh.unset.card", "missing", schemas)).toBeUndefined();
  });

  test("fill_regenerates_only_the_marked_blocks", () => {
    const page = "# Page\n\n<!-- schema:sh.unset.page#cardRef -->\nstale\n<!-- /schema -->\n\nOutro.\n";
    const filled = fill(page, schemas);
    expect(filled.startsWith("# Page\n\n<!-- schema:sh.unset.page#cardRef -->\n| Property |")).toBe(true);
    expect(filled.endsWith("<!-- /schema -->\n\nOutro.\n")).toBe(true);
    expect(fill(filled, schemas)).toBe(filled);
  });

  test("a_schema_or_sample_change_without_a_docs_update_fails", () => {
    const changed = structuredClone(schemas);
    const page = changed.find((s) => s.nsid === "sh.unset.page");
    const props = page?.defs.main?.record as { properties: Record<string, unknown> } | undefined;
    if (props) props.properties.title = { type: "string", maxLength: 100 };
    expect(docsProblems(changed)).toEqual([
      "docs/lexicons/page.md: a generated block is out of date; run npm run docs",
    ]);

    const root = copy();
    writeFileSync(join(root, "examples/sh/unset/card/links.json"), "{}\n");
    expect(docsProblems(schemas, root)).toEqual([
      "docs/lexicons/block-links.md: a generated block is out of date; run npm run docs",
    ]);
  });

  test("a_block_naming_nothing_and_an_undocumented_definition_fail", () => {
    const root = copy();
    writeFileSync(
      join(root, "docs/extra.md"),
      "<!-- schema:sh.unset.card#missing -->\n<!-- /schema -->\n\n<!-- example:examples/none.json -->\n<!-- /example -->\n",
    );
    rmSync(join(root, "docs/permissions.md"));
    expect(docsProblems(schemas, root)).toEqual([
      "docs/extra.md: sh.unset.card#missing is not a definition here",
      "docs/extra.md: examples/none.json is not a sample record here",
      "docs/: no page documents sh.unset.authFull#main",
    ]);
  });
});
