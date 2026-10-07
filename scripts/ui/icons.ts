// The icon build entry, `node scripts/ui/icons.ts [--check]` (P1.24i): binds node:fs and sha256 to the pure icon run in
// shared/ui-build. Writes only shared/ui/icons/icons.json and
// shared/ui/icons/drawings/; `--check` writes nothing. Nothing imports this file; freshness is the shared/ui-build product test (icon_allowlist_matches_sheet).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runIcons } from "@unset/shared-ui-build";

const UI = join(import.meta.dirname, "..", "..", "shared", "ui");

process.exitCode = runIcons(
  process.argv.slice(2),
  {
    readText: (path) => readFileSync(join(UI, path), "utf8"),
    sha256: (path) =>
      createHash("sha256")
        .update(readFileSync(join(UI, path)))
        .digest("hex"),
    list: (dir) => readdirSync(join(UI, dir)),
    writeText: (path, text) => {
      mkdirSync(dirname(join(UI, path)), { recursive: true });
      writeFileSync(join(UI, path), text);
    },
  },
  console.log,
);
