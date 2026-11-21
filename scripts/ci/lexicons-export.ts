// The public copy of our lexicons (P1.31v; ADR 0089): the file tree of github.com/unset-sh/lexicons, built from
// shared/lexicons. `node scripts/ci/lexicons-export.ts <new folder>` writes it; lexicons-mirror.yml pushes it. Each
// schema lands at the path its NSID gives, dots as folders under lexicons/, which is where `goat lex` looks by default
// (bluesky-social/goat at beec4d7: lex_lint.go `lexicons-dir`, lex_util_files.go) and how bluesky-social/atproto lays
// out lexicons/. Node built-ins only: the workflow job that runs this holds a deploy key and installs no package.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PACKAGE = join(import.meta.dirname, "..", "..", "shared", "lexicons");
/** An NSID file name: two or more dot-separated names of letters and digits, then `.json`. No slash, no empty part. */
const NSID_FILE = /^([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\.json$/;
/** The readme's status line while nothing is published. P1.35 removes it when it fills published.lock.json. */
export const DRAFT_NOTICE = "**Status: draft, not yet published on the network.**";
/** A lexicon named in the readme: `sh.unset.<name>` in backticks. The `sh.unset.*` pattern is not one. */
const NAMED = /`(sh\.unset\.[a-zA-Z][a-zA-Z0-9.]*)`/g;

/** `sh.unset.block.text.json` becomes `lexicons/sh/unset/block/text.json`; any other kind of name throws. */
export function publicPath(file: string): string {
  const nsid = NSID_FILE.exec(file)?.[1];
  if (nsid === undefined) throw new Error(`${file} is not an NSID file name`);
  return `lexicons/${nsid.replaceAll(".", "/")}.json`;
}

const schemaFiles = (root: string): string[] => readdirSync(join(root, "schemas")).sort();

/** Every file of the public repository, by its path there. Our schemas only: vendor/ holds other people's. */
export function publicTree(root = PACKAGE): Map<string, string> {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  const tree = new Map(schemaFiles(root).map((file) => [publicPath(file), read(`schemas/${file}`)]));
  tree.set("README.md", read("public-repo/README.md"));
  tree.set("CONTRIBUTING.md", read("public-repo/CONTRIBUTING.md"));
  tree.set("LICENSE", read("LICENSE"));
  return tree;
}

/** What the public readme gets wrong about this package: a lexicon it leaves out or invents, or a stale status. */
export function readmeProblems(root = PACKAGE): string[] {
  const readme = readFileSync(join(root, "public-repo", "README.md"), "utf8");
  const ours = schemaFiles(root).map((file) => file.replace(/\.json$/, ""));
  const named = new Set([...readme.matchAll(NAMED)].map((match) => match[1] as string));
  const problems = [
    ...ours.filter((id) => !named.has(id)).map((id) => `README.md does not name ${id}`),
    ...[...named].filter((id) => !ours.includes(id)).map((id) => `README.md names ${id}, which is not a lexicon here`),
  ];
  const lock = JSON.parse(readFileSync(join(root, "published.lock.json"), "utf8")) as Record<string, unknown>;
  const published = Object.keys(lock).length > 0;
  if (published && readme.includes(DRAFT_NOTICE))
    problems.push("README.md still says draft, but published.lock.json has entries");
  if (!published && !readme.includes(DRAFT_NOTICE))
    problems.push("README.md does not say draft, but nothing is published");
  return problems;
}

/** Writes the tree into `out`, which must not exist yet, so nothing from an earlier run can stay behind. */
export function writeTree(tree: ReadonlyMap<string, string>, out: string): void {
  mkdirSync(out);
  for (const [path, text] of tree) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), text);
  }
}

if (import.meta.main) {
  const out = process.argv[2];
  if (out === undefined || process.argv.length !== 3) throw new Error("usage: lexicons-export.ts <new folder>");
  writeTree(publicTree(), out);
}
