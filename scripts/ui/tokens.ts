// The token build entry, `node scripts/ui/tokens.ts [--check]` (P1.21; architecture record
// 2026-10-06-p121-token-pipeline-structure.md, point 5): binds node:fs and sha256 to the pure token run in shared/ui,
// which imports no Node built-in. Writes only shared/ui/src/tokens.css; `--check` writes nothing. Nothing imports this file, and neither CI nor `npm run check` runs it: freshness is the
// shared/ui product test (tokens_generate_matches_committed).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTokens } from "../../shared/ui/index.ts";

const UI = join(import.meta.dirname, "..", "..", "shared", "ui");

process.exitCode = runTokens(
  process.argv.slice(2),
  {
    readText: (path) => readFileSync(join(UI, path), "utf8"),
    sha256: (path) =>
      createHash("sha256")
        .update(readFileSync(join(UI, path)))
        .digest("hex"),
    writeText: (path, text) => writeFileSync(join(UI, path), text),
  },
  console.log,
);
