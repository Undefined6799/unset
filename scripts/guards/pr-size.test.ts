// P0.09h: the size count follows git's default rename detection, so a pure move costs 1 line, not its content twice.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { withoutGitEnv } from "./git-env.ts";
import { measurePrSize, NUMSTAT_ARGS, numstatLines } from "./pr-size.ts";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const lines = (n: number, tag = "line") => `${Array.from({ length: n }, (_, i) => `${tag} ${i}`).join("\n")}\n`;

/** A throwaway repository: `base` committed, then `change` applied and committed; the count over base...head. */
function countAfter(base: Record<string, string>, change: (dir: string) => void): number {
  const dir = mkdtempSync(join(tmpdir(), "pr-size-"));
  temps.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
      encoding: "utf8",
      env: withoutGitEnv(),
    });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git("init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(base)) put(path, text);
  git("add", "-A");
  git("commit", "-qm", "base");
  change(dir);
  git("add", "-A");
  git("commit", "-qm", "change");
  return measurePrSize(numstatLines(git("diff", ...NUMSTAT_ARGS, "HEAD~1...HEAD")), [], "").changed;
}

const mv = (dir: string, from: string, to: string, text: string) => {
  rmSync(join(dir, from));
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  writeFileSync(join(dir, to), text);
};

describe("pr size and renames", () => {
  const file = lines(300);

  test("pure_rename_counts_once", () => {
    expect(countAfter({ "apps/web/a.ts": file }, (dir) => mv(dir, "apps/web/a.ts", "apps/web/b/a.ts", file))).toBe(1);
  });

  test("rename_with_edit_counts_changed_lines", () => {
    const edited = file.replace("line 10\n", "edited 10\n").replace("line 20\n", "edited 20\n");
    // Two lines replaced: two deleted plus two added, the same as the edit in place.
    expect(countAfter({ "apps/web/a.ts": file }, (dir) => mv(dir, "apps/web/a.ts", "apps/web/b/a.ts", edited))).toBe(4);
  });

  test("delete_and_unrelated_add_still_count", () => {
    const other = lines(200, "other");
    const count = countAfter({ "apps/web/a.ts": file }, (dir) => mv(dir, "apps/web/a.ts", "apps/web/c.ts", other));
    expect(count).toBe(500);
  });

  test("rewrite_is_not_a_rename", () => {
    // 200 of 300 lines rewritten: below git's default 50% similarity, so it is a delete and an add.
    const rewritten = file
      .split("\n")
      .map((l, i) => (i < 200 ? `new ${i}` : l))
      .join("\n");
    const count = countAfter({ "apps/web/a.ts": file }, (dir) =>
      mv(dir, "apps/web/a.ts", "apps/web/b/a.ts", rewritten),
    );
    expect(count).toBe(600);
  });

  test("rename_out_of_tests_counts_once", () => {
    // Paths outside the count still decide by the new path: a pure move into source costs 1, a move into tests 0.
    expect(numstatLines("0\t0\t\0tests/a.ts\0apps/web/a.ts\0")).toBe("0\t0\tapps/web/a.ts\ttests/a.ts");
    expect(measurePrSize("0\t0\tapps/web/a.ts\ttests/a.ts", [], "").changed).toBe(1);
    expect(measurePrSize("0\t0\ttests/a.ts\tapps/web/a.ts", [], "").changed).toBe(0);
  });

  test("numstat_lines_refuses_newline_paths", () => {
    expect(() => numstatLines("1\t0\ta\nb.ts\0")).toThrow(/newline/);
    expect(() => numstatLines("0\t0\t\0a.ts\0b\nc.ts\0")).toThrow(/newline/);
  });
});
