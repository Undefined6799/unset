// P1.01 warns when a .github/CODEOWNERS path matches no file yet. That check never fails, because many owned
// areas arrive with later steps. P1.33m fails unless the trusted-base section owns the local Postgres init.
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

test("codeowners_trusted_base_owns_local_postgres_init", () => {
  const text = readFileSync(join(ROOT, ".github", "CODEOWNERS"), "utf8");
  const read = readTrustedBase(text);
  if (!read.ok) expect.fail(read.error);
  const section = text.slice(text.indexOf("# trusted base (SE-6)\n"));
  expect(section.split("\n")).toContain(`${LOCAL_INIT} @Undefined6799`);
  expect(read.section.patterns).toContain(LOCAL_INIT);
});
