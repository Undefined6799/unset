import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { fixtureGitEnv } from "../guards/git-env.ts";
import { docsTree, writeTree } from "./docs-export.ts";

const ROOT = join(import.meta.dirname, "..", "..");
/** The docs repository's own files, as a fixture repository holds them. */
const OWN = { "deployment/docs-repo/README.md": "front\n", "deployment/docs-repo/site.yml": "name: site\n" };

/** A throwaway repository holding `tracked` (path to text), committed, plus whatever `after` adds untracked. */
function planted(tracked: Record<string, string>, after?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "unset-docs-export-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: fixtureGitEnv() });
  git("init", "--quiet");
  for (const [path, text] of Object.entries(tracked)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git("add", "--all");
  after?.(root);
  return root;
}

describe("this repository's folder in the docs repository", () => {
  test("holds_the_docs_site_and_the_human_docs_beside_it", () => {
    const tree = docsTree();
    // The folder builds on its own: the site, its module pins, and the ADR folder hugo.yaml mounts as ../human/decisions.
    expect(tree.get("unset/site/hugo.yaml")).toBe("docs/site/hugo.yaml");
    expect(tree.get("unset/site/go.sum")).toBe("docs/site/go.sum");
    expect(tree.get("unset/site/content/_index.md")).toBe("docs/site/content/_index.md");
    expect(tree.get("unset/human/decisions/legacy-index.yaml")).toBe("docs/human/decisions/legacy-index.yaml");
    expect(tree.get("unset/human/runbooks/docs-site.md")).toBe("docs/human/runbooks/docs-site.md");
    expect(readFileSync(join(ROOT, "docs/site/hugo.yaml"), "utf8")).toContain("source: ../human/decisions");
    // The docs repository's own files are the only ones outside the folder: its front page and its Pages workflow.
    expect(tree.get("README.md")).toBe("deployment/docs-repo/README.md");
    expect(tree.get(".github/workflows/site.yml")).toBe("deployment/docs-repo/site.yml");
    expect([...tree.keys()].filter((path) => !path.startsWith("unset/"))).toEqual([
      "README.md",
      ".github/workflows/site.yml",
    ]);
    // Working material for agents is not human documentation.
    expect([...tree.values()].filter((path) => path.startsWith("docs/ai/"))).toEqual([]);
  });

  test("only_tracked_files_under_the_two_folders_are_taken", () => {
    const root = planted(
      {
        "docs/site/content/a.md": "a\n",
        "docs/human/glossary.md": "g\n",
        "docs/ai/notes/n.md": "n\n",
        "deployment/docs-repo/README.md": "front\n",
        "deployment/docs-repo/site.yml": "name: site\n",
        "secret.txt": "s\n",
      },
      (at) => {
        // Build output and a stray file: on disk, never added.
        mkdirSync(join(at, "docs/site/public"));
        writeFileSync(join(at, "docs/site/public/index.html"), "<p>built</p>");
        writeFileSync(join(at, "docs/human/draft.md"), "not committed\n");
      },
    );
    expect(Object.fromEntries(docsTree(root))).toEqual({
      ".github/workflows/site.yml": "deployment/docs-repo/site.yml",
      "README.md": "deployment/docs-repo/README.md",
      "unset/human/glossary.md": "docs/human/glossary.md",
      "unset/site/content/a.md": "docs/site/content/a.md",
    });
  });

  test("a_tracked_link_is_refused", () => {
    // A link is copied as what it points at, which may be any file the runner can read.
    const root = planted({ "docs/site/content/a.md": "a\n", ...OWN }, (at) => {
      symlinkSync("/etc/hostname", join(at, "docs/human-link.md"));
      mkdirSync(join(at, "docs/human"));
      symlinkSync("/etc/hostname", join(at, "docs/human/host.md"));
      execFileSync("git", ["add", "--all"], { cwd: at, env: fixtureGitEnv() });
    });
    expect(() => docsTree(root)).toThrow("docs/human/host.md is not a regular file");
  });

  test("an_empty_folder_is_refused", () => {
    // Pushing nothing would delete every page in the docs repository.
    const root = planted({ ...OWN, "docs/ai/notes/n.md": "n\n" });
    expect(() => docsTree(root)).toThrow("no tracked file under docs/human or docs/site");
  });

  test("the_tree_is_written_byte_for_byte_into_a_new_folder", () => {
    const root = planted({ "docs/site/content/a.md": "a\n", ...OWN });
    const out = join(mkdtempSync(join(tmpdir(), "unset-docs-out-")), "tree");
    writeTree(docsTree(root), root, out);
    expect(readFileSync(join(out, "unset/site/content/a.md"), "utf8")).toBe("a\n");
    expect(readFileSync(join(out, "README.md"), "utf8")).toBe("front\n");
    expect(existsSync(join(out, "unset/human"))).toBe(false);
    // A folder that already exists could hold files from an earlier run.
    expect(() => writeTree(docsTree(root), root, out)).toThrow();
  });
});
