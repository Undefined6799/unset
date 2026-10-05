// P0.09d: the notes guard against a good fixture vault and one planted fault per rule, each failing for its rule only.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { type Finding, report } from "./files.ts";
import { withoutGitEnv } from "./git-env.ts";
import { buildIndex, changedPaths, checkNotes, loadNotes, parseNote, VAULT } from "./notes.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const GOOD = join(import.meta.dirname, "fixtures", "notes", "good");
const TODAY = new Date("2026-10-20T12:00:00Z"); // TE-4: the clock is injected.
const PITFALL = `${VAULT}/notes/pitfall/handle-checked-both-ways.md`;
const HANDOFF = `${VAULT}/notes/handoff/finish-identity-slice.md`;
const AREA = `${VAULT}/notes/area/identity.md`;

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Edit = (files: Map<string, string | null>) => void;

/** A copy of the good vault with `edit` applied (null deletes a file), and INDEX.md regenerated to match. */
function vault(edit?: Edit): string {
  const root = mkdtempSync(join(tmpdir(), "notes-"));
  temps.push(root);
  cpSync(GOOD, root, { recursive: true });
  const files = new Map<string, string | null>();
  for (const path of [PITFALL, HANDOFF, AREA]) files.set(path, readFileSync(join(root, path), "utf8"));
  edit?.(files);
  for (const [path, body] of files) {
    if (body === null) rmSync(join(root, path));
    else {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
  }
  writeFileSync(join(root, VAULT, "INDEX.md"), buildIndex(loadNotes(root).notes));
  return root;
}

const change =
  (path: string, from: string | RegExp, to: string): Edit =>
  (files) => {
    const body = files.get(path) ?? "";
    const next = body.replace(from, to);
    expect(next, `edit applies to ${path}`).not.toBe(body);
    files.set(path, next);
  };
const move =
  (from: string, to: string): Edit =>
  (files) => {
    files.set(to, files.get(from) ?? "");
    files.set(from, null);
  };

const rules = (findings: readonly Finding[]): string[] => [...new Set(findings.map((f) => f.rule))];
const errorsOf = (root: string, changed?: string[]) => checkNotes(root, { today: TODAY, changedPaths: changed }).errors;
/** The vault with `edit` fails for `rule` only. */
const failsFor = (rule: string, edit: Edit): void => {
  const errors = errorsOf(vault(edit));
  expect(rules(errors), report(errors)).toEqual([rule]);
};

describe("header", () => {
  test("notes_header_bad_type", () => failsFor("notes-header", change(PITFALL, "type: pitfall", "type: lesson")));
  test("notes_header_missing_field", () => failsFor("notes-header", change(PITFALL, /^importance: high\n/m, "")));
  test("notes_header_area_not_listed", () =>
    failsFor("notes-header", change(AREA, 'areas: ["[[identity]]"]', 'areas: ["[[identity]]", "[[billing]]"]')));
  test("notes_header_shapes", () => {
    const good = readFileSync(join(GOOD, PITFALL), "utf8");
    const bad = (from: string | RegExp, to: string) => parseNote(PITFALL, good.replace(from, to));
    for (const parsed of [
      bad("importance: high", "importance: high # must read"),
      bad("importance: high", "importance: high\nimportance: high"),
      bad("importance: high", "importance: high\nowner: alex"),
      bad('summary: "Trap: a', "summary: Trap: a"),
      bad("checked: 2026-10-04", "checked: 2026-02-30"),
      bad('related: ["[[identity]]"]', "related: [identity]"),
      bad("replaced_by: null", 'replaced_by: "[[identity]]"'),
      bad(/^---\n/, ""),
      bad("importance: high", "importance: true"),
      bad("domains/identity/README.md", 'domains/a"b, c"'),
    ]) {
      expect(Array.isArray(parsed) && rules(parsed), JSON.stringify(parsed)).toEqual(["notes-header"]);
    }
    // Obsidian reads a byte-order mark, CRLF line ends and a blank header line; so does the guard.
    expect(Array.isArray(parseNote(PITFALL, `\uFEFF${good.replaceAll("\n", "\r\n")}`))).toBe(false);
    expect(Array.isArray(parseNote(PITFALL, good.replace("type: pitfall\n", "type: pitfall\n\n")))).toBe(false);
  });

  test("notes_header_future_checked", () =>
    failsFor("notes-header", change(HANDOFF, "checked: 2026-10-06", "checked: 2099-01-01")));

  test("notes_header_bad_areas_reported_once", () => {
    const errors = errorsOf(vault(change(AREA, 'areas: ["[[identity]]"]', "areas: identity")));
    expect(errors.map((f) => f.text)).toEqual(["areas must be a list"]);
  });
});

describe("id, summary and tags", () => {
  test("notes_id_mismatch", () =>
    failsFor("notes-id", move(PITFALL, `${VAULT}/notes/pitfall/handle-checked-one-way.md`)));
  test("notes_wrong_folder", () =>
    failsFor("notes-id", move(PITFALL, `${VAULT}/notes/reference/handle-checked-both-ways.md`)));
  test("notes_nested_folder", () => {
    failsFor("notes-id", move(PITFALL, `${VAULT}/notes/pitfall/old/handle-checked-both-ways.md`));
    failsFor("notes-id", move(PITFALL, `${VAULT}/notes/junk/pitfall/handle-checked-both-ways.md`));
  });

  test("notes_only_notes_under_notes", () => {
    failsFor("notes-id", (files) => files.set(`${VAULT}/notes/pitfall/draft.txt`, "x"));
    failsFor("notes-id", (files) => files.set(`${VAULT}/notes/pitfall/draft.MD`, "x"));
  });

  test("notes_duplicate_id", () => {
    const copy: Edit = (files) => files.set(`${VAULT}/notes/handoff/identity.md`, files.get(AREA) ?? "");
    failsFor("notes-id", copy);
  });

  test("notes_summary_121_chars", () => {
    const summary = (n: number): Edit => change(AREA, /^summary: .*$/m, `summary: ${"x".repeat(n)}`);
    failsFor("notes-summary", summary(121));
    failsFor("notes-summary", change(AREA, /^summary: .*$/m, 'summary: "   "'));
    expect(errorsOf(vault(summary(120)))).toEqual([]);
  });

  test("notes_tags_mismatch", () =>
    failsFor("notes-tags", change(PITFALL, "tags: [pitfall, identity, pds]", "tags: [pitfall, identity]")));
});

describe("links", () => {
  test("notes_dead_related", () =>
    failsFor("notes-link", change(HANDOFF, "[[handle-checked-both-ways]]", "[[no-such-note]]")));
  test("notes_dead_replaced_by", () => {
    const old = `${VAULT}/notes/reference/handle-resolution-old.md`;
    failsFor("notes-link", (files) => {
      files.set(old, readFileSync(join(GOOD, old), "utf8").replace("[[handle-checked-both-ways]]", "[[gone]]"));
    });
  });
  test("notes_dead_code_path", () => {
    failsFor("notes-link", change(PITFALL, "domains/identity/README.md", "domains/identity/verify.ts"));
    // A path that is not plain would never match a changed file, so it is a header error, not a link.
    for (const path of ["../outside.md", "./domains/identity/README.md", "domains//identity/README.md", "/etc/x"]) {
      failsFor("notes-header", change(PITFALL, "domains/identity/README.md", path));
    }
  });
});

describe("index", () => {
  test("notes_index_stale_fails", () => {
    const root = vault();
    const index = readFileSync(join(root, VAULT, "INDEX.md"), "utf8");
    const missing = index.replace(/^\| \[identity\].*\n/m, "");
    expect(missing).not.toBe(index);
    writeFileSync(join(root, VAULT, "INDEX.md"), missing);
    expect(rules(errorsOf(root))).toEqual(["notes-index"]);
  });

  test("notes_index_escapes_pipes", () => {
    const root = vault(change(AREA, /^summary: .*$/m, "summary: a | b"));
    expect(readFileSync(join(root, VAULT, "INDEX.md"), "utf8")).toContain("| a \\| b |");
    expect(errorsOf(root)).toEqual([]);
  });
});

describe("code moved", () => {
  test("notes_code_moved_fails", () => {
    const root = vault();
    const code = "domains/identity/README.md";
    const errors = errorsOf(root, [code]);
    // The area hub names the folder and the pitfall names the file: both must be touched.
    expect(errors.map((f) => [f.rule, f.file])).toEqual([
      ["notes-code-moved", AREA],
      ["notes-code-moved", PITFALL],
    ]);
    expect(errorsOf(root, [code, AREA, PITFALL])).toEqual([]);
    expect(errorsOf(root, ["domains/identityx/a.ts"])).toEqual([]);
    // CI mode with no usable base fails closed.
    for (const base of [undefined, "0".repeat(40), "main", "f".repeat(40)]) {
      const env = base === undefined ? { CI: "true" } : { CI: "true", BASE_SHA: base };
      expect(changedPaths(ROOT, env).problem?.rule).toBe("notes-code-moved");
    }
  });

  test("notes_code_moved_sees_both_sides_of_a_move", () => {
    const root = vault();
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
        cwd: root,
        encoding: "utf8",
        env: withoutGitEnv(),
      });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD").trim();
    mkdirSync(join(root, "domains", "other"));
    git("mv", "domains/identity/README.md", "domains/other/README.md");
    git("commit", "-qm", "move");
    const { paths } = changedPaths(root, { CI: "true", BASE_SHA: base });
    expect(paths).toEqual(["domains/identity/README.md", "domains/other/README.md"]);
  });
});

describe("handoffs and warnings", () => {
  test("notes_handoff_15_days", () => {
    failsFor("notes-handoff-age", change(HANDOFF, "checked: 2026-10-06", "checked: 2026-10-05"));
    expect(errorsOf(vault())).toEqual([]); // The fixture handoff is exactly 14 days old.
  });

  test("notes_warn_checked_91_days", () => {
    const at = (date: string) =>
      checkNotes(vault(change(AREA, "checked: 2026-10-04", `checked: ${date}`)), { today: TODAY });
    const stale = at("2026-07-21");
    expect(stale.errors).toEqual([]);
    expect(stale.warnings.map((f) => [f.rule, f.file])).toEqual([["notes-stale", AREA]]);
    expect(at("2026-07-22").warnings).toEqual([]);
  });

  test("notes_warn_area_without_hub", () => {
    const root = vault();
    mkdirSync(join(root, "infrastructure", "net-guard"), { recursive: true });
    const { errors, warnings } = checkNotes(root, { today: TODAY });
    expect(errors).toEqual([]);
    expect(warnings.map((f) => [f.rule, f.file])).toEqual([["notes-hub", "infrastructure/net-guard"]]);
  });
});

describe("vault", () => {
  test("notes_good_vault", () => {
    const fixture = checkNotes(GOOD, { today: TODAY, changedPaths: [] });
    expect(fixture.errors, report(fixture.errors)).toEqual([]);
    expect(fixture.warnings).toEqual([]);
    expect(fixture.scanned).toBe(4); // AB-4: the scan saw the fixture notes.

    // The real vault, against the real clock and this change's files.
    const changed = changedPaths(ROOT, process.env);
    const real = checkNotes(ROOT, { today: new Date(), changedPaths: changed.paths });
    const warnings = [...real.warnings, ...(changed.problem && !process.env.CI ? [changed.problem] : [])];
    for (const line of report(warnings).split("\n").filter(Boolean)) process.stderr.write(`::warning::${line}\n`);
    const errors = [...real.errors, ...(changed.problem && process.env.CI ? [changed.problem] : [])];
    expect(errors, report(errors)).toEqual([]);
  });

  test("vault_skeleton", () => {
    for (const type of ["area", "reference", "pitfall", "how-to", "handoff"]) {
      expect(() => readFileSync(join(ROOT, VAULT, "notes", type, ".gitkeep"))).not.toThrow();
    }
    expect(() => readFileSync(join(ROOT, VAULT, "notes.base"))).not.toThrow();
    const graph = JSON.parse(readFileSync(join(ROOT, VAULT, ".obsidian", "graph.json"), "utf8")) as {
      colorGroups: { query: string }[];
    };
    expect(graph.colorGroups.map((g) => g.query)).toEqual(
      expect.arrayContaining(["path:notes/pitfall", "path:notes/reference", "path:notes/handoff"]),
    );
    const ignore = readFileSync(join(ROOT, VAULT, ".obsidian", ".gitignore"), "utf8");
    expect(ignore.split("\n").filter(Boolean)).toEqual(["*", "!graph.json", "!.gitignore"]);
  });
});
