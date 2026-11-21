import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DRAFT_NOTICE, publicPath, publicTree, readmeProblems, writeTree } from "./lexicons-export.ts";

const PACKAGE = join(import.meta.dirname, "..", "..", "shared", "lexicons");
const read = (path: string): string => readFileSync(join(PACKAGE, path), "utf8");

/** A package folder with the given schema file names, a readme naming `named`, and the given lock. */
function planted(schemas: string[], named: string[], lock = "{}", notice = DRAFT_NOTICE): string {
  const root = mkdtempSync(join(tmpdir(), "unset-export-"));
  for (const dir of ["schemas", "public-repo"]) mkdirSync(join(root, dir));
  for (const name of schemas) writeFileSync(join(root, "schemas", name), "{}");
  writeFileSync(join(root, "public-repo", "README.md"), `${notice}\n${named.map((id) => `\`${id}\``).join("\n")}\n`);
  writeFileSync(join(root, "public-repo", "CONTRIBUTING.md"), "how\n");
  writeFileSync(join(root, "LICENSE"), "MIT\n");
  writeFileSync(join(root, "published.lock.json"), lock);
  return root;
}

describe("public lexicons tree", () => {
  test("each_lexicon_sits_at_the_path_its_name_gives", () => {
    // goat at beec4d7, lex_util_files.go: the path is the NSID with its dots as folders, under lexicons/.
    expect(publicPath("sh.unset.card.json")).toBe("lexicons/sh/unset/card.json");
    expect(publicPath("sh.unset.block.text.json")).toBe("lexicons/sh/unset/block/text.json");
    const tree = publicTree();
    const schemas = readdirSync(join(PACKAGE, "schemas")).sort();
    expect(schemas).toHaveLength(9);
    for (const name of schemas) expect(tree.get(publicPath(name)), name).toBe(read(`schemas/${name}`));
    expect(tree.get("README.md")).toBe(read("public-repo/README.md"));
    expect(tree.get("CONTRIBUTING.md")).toBe(read("public-repo/CONTRIBUTING.md"));
    expect(tree.get("LICENSE")).toBe(read("LICENSE"));
    // Nothing else: no vendored Bluesky lexicon, no script, no generated code.
    expect(tree.size).toBe(schemas.length + 3);
    expect(
      [...tree.keys()].filter((path) => path.startsWith("lexicons/") && !path.startsWith("lexicons/sh/unset/")),
    ).toEqual([]);
  });

  test("a_file_name_that_is_not_an_nsid_is_refused", () => {
    // The name becomes a path in another repository, so it may hold no slash, no `..` and no empty part.
    for (const name of [
      "../evil.json",
      "sh.unset..card.json",
      "sh/unset.json",
      "card.json",
      ".json",
      "sh.unset.card",
    ]) {
      expect(() => publicPath(name), name).toThrow("not an NSID file name");
    }
    const root = planted(["sh.unset.card.json", "notes.txt"], ["sh.unset.card"]);
    try {
      expect(() => publicTree(root)).toThrow("not an NSID file name");
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("the_readme_names_every_lexicon_and_no_other", () => {
    expect(readmeProblems()).toEqual([]);
    const missing = planted(["sh.unset.card.json", "sh.unset.block.text.json"], ["sh.unset.card"]);
    const extra = planted(["sh.unset.card.json"], ["sh.unset.card", "sh.unset.follow"]);
    try {
      expect(readmeProblems(missing)).toEqual(["README.md does not name sh.unset.block.text"]);
      expect(readmeProblems(extra)).toEqual(["README.md names sh.unset.follow, which is not a lexicon here"]);
    } finally {
      for (const root of [missing, extra]) rmSync(root, { recursive: true });
    }
  });

  test("the_readme_says_draft_exactly_while_nothing_is_published", () => {
    const lock = '{"sh.unset.card":{"cid":"x"}}';
    const stale = planted(["sh.unset.card.json"], ["sh.unset.card"], lock);
    const silent = planted(["sh.unset.card.json"], ["sh.unset.card"], "{}", "Published.");
    const current = planted(["sh.unset.card.json"], ["sh.unset.card"], lock, "Published.");
    try {
      expect(readmeProblems(stale)).toEqual(["README.md still says draft, but published.lock.json has entries"]);
      expect(readmeProblems(silent)).toEqual(["README.md does not say draft, but nothing is published"]);
      expect(readmeProblems(current)).toEqual([]);
    } finally {
      for (const root of [stale, silent, current]) rmSync(root, { recursive: true });
    }
  });

  test("the_tree_is_written_only_into_a_new_folder", () => {
    const work = mkdtempSync(join(tmpdir(), "unset-export-out-"));
    try {
      const out = join(work, "tree");
      writeTree(publicTree(), out);
      expect(readFileSync(join(out, "lexicons", "sh", "unset", "block", "text.json"), "utf8")).toBe(
        read("schemas/sh.unset.block.text.json"),
      );
      expect(readdirSync(out).sort()).toEqual(["CONTRIBUTING.md", "LICENSE", "README.md", "lexicons"]);
      // A second run must not merge into what is there: a lexicon removed since would stay.
      expect(() => writeTree(publicTree(), out)).toThrow();
    } finally {
      rmSync(work, { recursive: true });
    }
  });
});
