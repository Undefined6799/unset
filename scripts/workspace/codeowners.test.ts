// P1.01 warns when a .github/CODEOWNERS path matches no file yet. That check never fails, because many owned
// areas arrive with later steps. P1.33m fails unless the trusted-base section owns the local Postgres init.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readTrustedBase } from "../guards/trusted-base.ts";

const ROOT = join(import.meta.dirname, "..", "..");
/** Local-only cluster init. P1.34u creates the PLC role here; dev and prod never mount this folder. */
const LOCAL_INIT = "/deployment/postgres/init-local/";

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

/**
 * The last matching pattern owns the file (GitHub, "About code owners", CODEOWNERS syntax:
 * https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
 * A trailing slash owns that root directory and everything under it, as `/build/logs/` does in that example.
 */
function lastOwner(text: string, file: string): { pattern: string; owners: string[] } | undefined {
  let found: { pattern: string; owners: string[] } | undefined;
  for (const line of text.split("\n")) {
    const code = line.replace(/\s+#.*$/, "").trim();
    if (code === "" || code.startsWith("#")) continue;
    const [pattern, ...owners] = code.split(/\s+/);
    if (pattern === undefined) continue;
    const rooted = pattern.replace(/^\//, "");
    const matches =
      pattern === "*" ||
      (rooted.endsWith("/") ? file === rooted.slice(0, -1) || file.startsWith(rooted) : file === rooted);
    if (matches) found = { pattern, owners };
  }
  return found;
}

test("no_island_paths_are_left", () => {
  // P1.20k: the React islands and their runtime are deleted, and so are their ownership lines. A .island.tsx that
  // came back would need its owner again.
  const text = readFileSync(join(ROOT, ".github", "CODEOWNERS"), "utf8");
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0");
  expect(listed.filter((path) => path.endsWith(".island.tsx"))).toEqual([]);
  expect(text).not.toContain("/shared/islands/");
  expect(text).not.toContain("/shared/ui/islands/");
});

test("codeowners_trusted_base_owns_local_postgres_init", () => {
  const text = readFileSync(join(ROOT, ".github", "CODEOWNERS"), "utf8");
  const read = readTrustedBase(text);
  if (!read.ok) expect.fail(read.error);
  const section = text.slice(text.indexOf("# trusted base (SE-6)\n"));
  expect(section.split("\n")).toContain(`${LOCAL_INIT} @Undefined6799`);
  expect(read.section.patterns).toContain(LOCAL_INIT);
});
