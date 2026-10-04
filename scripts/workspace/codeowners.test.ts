// Warning only (P1.01): prints each .github/CODEOWNERS path that matches no file yet, so a path that drifted
// from the layout is noticed. It never fails, because many owned areas arrive with later steps.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

/** The rooted paths in CODEOWNERS (`/shared/http/`), without the default `*` line. */
function ownedPaths(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("/"))
    .map((line) => line.split(/\s+/)[0] ?? "");
}

test("codeowners_security_paths_match", () => {
  const paths = ownedPaths(readFileSync(join(ROOT, ".github", "CODEOWNERS"), "utf8"));
  expect(paths.length).toBeGreaterThan(0);
  const unmatched = [...new Set(paths)].filter((path) => !existsSync(join(ROOT, path)));
  if (unmatched.length > 0) {
    console.warn(`CODEOWNERS paths that match nothing yet (${unmatched.length}):\n  ${unmatched.join("\n  ")}`);
  }
});
