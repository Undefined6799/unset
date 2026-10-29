// Docs-only allowlist (P0.07e; ADR 0034). One definition, used by the read-only
// `docs-only` check and by the default-branch auto-merge script. A pull request
// is docs-only only when every changed path is allowed, including a rename's
// old path and a deletion. Anything else, an empty list, or an unreadable
// status fails closed.
//
// Allowed: Markdown (`.md`) files under docs/human/** except
// docs/human/decisions/**, docs/human/engineering/** (CLAUDE.md imports it),
// docs/human/runbooks/** and docs/human/legal/** (those prefixes compared
// case-insensitively, because the parent is allowed), under docs/site/** and
// docs/ai/notes/**, and README.md. Nothing else: no site config, module
// manifest, vendored script or image (P0.07k). The lexicon generator
// (shared/lexicons/scripts/build.ts and shared/lexicons/generated/) is not
// allowed, nor is CLAUDE.md, AGENTS.md, the plan, the step book, .github/,
// scripts/, or a manifest or lockfile.

export type ChangedPath = { path: string; previous?: string };

const HUMAN = "docs/human/";
/** Under docs/human/ but reviewed as code: ADRs, the rules every agent loads, operator and legal procedure. */
const REVIEWED = ["decisions", "engineering", "runbooks", "legal"].map((folder) => `${HUMAN}${folder}`);
const MAX_PATH = 4096;

/** A single relative path git or the pulls files API can name. `..` and odd forms fail. */
export function pathAllowed(path: string): boolean {
  if (!safeRelative(path)) return false;
  if (path === "README.md") return true;
  if (!path.endsWith(".md")) return false;
  if (path.startsWith("docs/site/") || path.startsWith("docs/ai/notes/")) return true;
  const lower = path.toLowerCase();
  if (REVIEWED.some((folder) => lower === folder || lower.startsWith(`${folder}/`))) return false;
  return path.startsWith(HUMAN);
}

function safeRelative(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH) return false;
  if (path.includes("\\") || path.includes("\0") || path.includes("//")) return false;
  if (path.startsWith("/") || path.endsWith("/")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** The first path that keeps this change from being docs-only, or null when every path is allowed. */
export function docsOnlyRejection(paths: readonly ChangedPath[]): string | null {
  if (paths.length === 0) return "empty file list";
  for (const change of paths) {
    if (!pathAllowed(change.path)) return change.path;
    if (change.previous !== undefined && !pathAllowed(change.previous)) return change.previous;
  }
  return null;
}

/**
 * `git diff --name-status -z` (git v2.43 `Documentation/diff-format.txt`: status, then
 * the path, and for a rename or copy the old path then the new path, NUL-separated).
 * An unknown status or a truncated record throws: the caller fails closed.
 */
export function parseNameStatus(z: string): ChangedPath[] {
  if (z === "") return [];
  const parts = z.split("\0");
  if (parts.at(-1) === "") parts.pop();
  const out: ChangedPath[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i];
    if (status === undefined || status === "") throw new Error("empty git status");
    const code = status[0];
    if (code === "R" || code === "C") {
      const previous = parts[i + 1];
      const path = parts[i + 2];
      if (previous === undefined || path === undefined || previous === "" || path === "") {
        throw new Error("truncated rename");
      }
      out.push({ path, previous });
      i += 3;
      continue;
    }
    if (code === "A" || code === "M" || code === "D" || code === "T") {
      const path = parts[i + 1];
      if (path === undefined || path === "") throw new Error("truncated path");
      out.push({ path });
      i += 2;
      continue;
    }
    throw new Error(`unknown git status ${status}`);
  }
  return out;
}
