// What this repository sends to the docs repository, github.com/unset-sh/docs (P1.21t; ADR 0111): its own folder,
// `unset/`, and the docs repository's own files (its front page and its Pages workflow).
// `node scripts/ci/docs-export.ts <new folder>` writes the tree; docs-mirror.yml pushes it. docs/human and docs/site
// keep their places beside each other, so `unset/site` builds there as docs/site builds here: hugo.yaml reads the
// ADRs through `../human/decisions`. Only files git tracks are taken, so build output and anything else left on disk
// stay out. Node built-ins and git only: the workflow job that runs this holds a deploy key and installs no package.
import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { withoutGitEnv } from "../guards/git-env.ts";

const ROOT = join(import.meta.dirname, "..", "..");
/** This repository's folder in the docs repository. Every source repository has one, named after it. */
const FOLDER = "unset";
/** The human documentation: what a person reads, and the site built from it. docs/ai is working material. */
const SOURCES = ["docs/human", "docs/site"];
/** The docs repository's own files, kept here while the site is decided here, by their path there. */
const OWN_FILES = {
  "README.md": "deployment/docs-repo/README.md",
  ".github/workflows/site.yml": "deployment/docs-repo/site.yml",
};

/** Each file of the tree by its path in the docs repository, with the path it is copied from. */
export function docsTree(root = ROOT): Map<string, string> {
  // `-z` ends each path with a NUL and quotes nothing (git v2.43 Documentation/git-ls-files.txt, "-z").
  const listed = execFileSync("git", ["ls-files", "-z", "--", ...SOURCES], {
    cwd: root,
    encoding: "utf8",
    env: withoutGitEnv(),
  });
  const tracked = listed.split("\0").filter(Boolean).sort();
  if (tracked.length === 0) throw new Error(`no tracked file under ${SOURCES.join(" or ")}`);
  const tree = new Map(Object.entries(OWN_FILES));
  for (const path of tracked) tree.set(`${FOLDER}/${path.slice("docs/".length)}`, path);
  // A link or a submodule would be copied as whatever it points at on the runner.
  for (const path of tree.values())
    if (!lstatSync(join(root, path)).isFile()) throw new Error(`${path} is not a regular file`);
  return tree;
}

/** Copies the tree into `out`, which must not exist yet, so nothing from an earlier run can stay behind. */
export function writeTree(tree: ReadonlyMap<string, string>, root: string, out: string): void {
  mkdirSync(out);
  for (const [to, from] of tree) {
    mkdirSync(dirname(join(out, to)), { recursive: true });
    copyFileSync(join(root, from), join(out, to));
  }
}

if (import.meta.main) {
  const out = process.argv[2];
  if (out === undefined || process.argv.length !== 3) throw new Error("usage: docs-export.ts <new folder>");
  writeTree(docsTree(), ROOT, out);
}
