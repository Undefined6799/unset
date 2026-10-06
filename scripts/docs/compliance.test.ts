// P1.36: the compliance skeletons in docs/human/compliance/ stay honest. Every ASVS 5.0 Level 1 and Level 2 id has one
// row, every evidence pointer resolves, the RoPA names a lawful basis per row, and the AI system record has every field
// the plan asks for. STRICT=1 (launch gate L.03) also fails on any open or partial row and any TBD field.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  AI_RECORD,
  AI_RECORD_FIELDS,
  AI_RECORD_MODELS,
  ASVS_CSV,
  ASVS_DOC,
  aiRecordProblems,
  asvsRows,
  csvLevelIds,
  enabledLintRules,
  evidenceProblems,
  pinProblems,
  ROPA,
  ropaProblems,
  rowsCompleteProblems,
  strictProblems,
} from "./compliance.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const STRICT = process.env.STRICT === "1";
const doc = read(ASVS_DOC);
const ids = csvLevelIds(read(ASVS_CSV));

test("asvs_csv_pinned", () => {
  expect(pinProblems(doc, readFileSync(join(ROOT, ASVS_CSV)))).toEqual([]);
  expect(pinProblems(doc, Buffer.from("chapter_id,req_id,L\n"))).toEqual([
    expect.stringMatching(/^asvs-5\.0\.csv sha256 [0-9a-f]{64} differs from the pinned/),
  ]);
  expect(pinProblems("no pin here", Buffer.from(""))).toEqual(["asvs-5-l2.md has no sha256 line"]);
});

test("asvs_rows_complete", () => {
  // The official list has 70 Level 1 and 183 Level 2 requirements.
  expect(ids).toHaveLength(253);
  expect(rowsCompleteProblems(asvsRows(doc), ids)).toEqual([]);
  const row = (id: string, status = "open") => `| ${id} | x | ${status} | \`step:P2.03\` | P2.03 |`;
  expect(rowsCompleteProblems(asvsRows([row("V1.1.1"), row("V1.1.1")].join("\n")), ["V1.1.1", "V1.1.2"])).toEqual([
    "V1.1.1: 2 rows",
    "V1.1.2: no row",
  ]);
  expect(rowsCompleteProblems(asvsRows([row("V1.1.1"), row("V9.9.9", "done")].join("\n")), ["V1.1.1"])).toEqual([
    "V9.9.9: not a Level 1 or 2 id of the pinned list",
    "V9.9.9: status done is not covered, partial, open or n/a",
  ]);
});

test("asvs_evidence_exists", () => {
  const lint = enabledLintRules(ROOT);
  expect(evidenceProblems(ROOT, asvsRows(doc), lint)).toEqual([]);
  const cases: [string, string][] = [
    ["covered | `test:shared/http/server.test.ts#no_such_test`", "test shared/http/server.test.ts#no_such_test"],
    ["covered | `test:shared/http/missing.test.ts#health_ok_with_commit`", "test shared/http/missing.test.ts"],
    ["covered | `lint:no-such-rule`", "lint rule no-such-rule"],
    ["covered | `guard:no-such-guard`", "guard scripts/guards/no-such-guard.ts"],
    ["covered | `doc:docs/human/no-such.md`", "doc docs/human/no-such.md"],
    ["covered | `step:P2.03`", "covered needs evidence that is not step:"],
    ["open | `test:shared/http/server.test.ts#health_ok_with_commit`", "open allows step: evidence only"],
    ["partial | ", "partial needs evidence"],
    ["n/a | ", "n/a needs a reason"],
    ["open | `step:2.03`", "step 2.03 is not a step id"],
    ["covered | `nope:x`", "evidence nope:x has no known kind"],
  ];
  for (const [cells, problem] of cases) {
    const found = evidenceProblems(ROOT, asvsRows(`| V1.1.1 | x | ${cells} | — |`), lint);
    expect(found, cells).toEqual([expect.stringContaining(`V1.1.1: ${problem}`)]);
  }
  const good = "covered | `test:shared/http/server.test.ts#health_ok_with_commit`, `lint:computed-import`";
  expect(evidenceProblems(ROOT, asvsRows(`| V1.1.1 | x | ${good} | — |`), lint)).toEqual([]);
  expect(lint).toEqual(expect.arrayContaining(["computed-import", "noExplicitAny", "no-style-prop"]));
});

test("asvs_strict_fails_on_open", () => {
  const rows = asvsRows(
    [
      "| V1.1.1 | x | open | | — |",
      "| V1.1.2 | x | partial | `doc:README.md` | — |",
      "| V1.2.1 | x | n/a | n/a: y | — |",
    ].join("\n"),
  );
  expect(strictProblems(rows)).toEqual(["V1.1.1 is open", "V1.1.2 is partial"]);
  if (STRICT) expect(strictProblems(asvsRows(doc))).toEqual([]);
});

test("ropa_has_lawful_basis_per_row", () => {
  const ropa = read(ROPA);
  expect(ropaProblems(ropa)).toEqual([]);
  const blank = ropa.replace(/^(\| Accounts \|[^|]*\|[^|]*\|)[^|]*\|/m, "$1 |");
  expect(ropaProblems(blank)).toEqual(["RoPA row Accounts has no lawful basis"]);
});

test("ropa_has_device_table_and_test_track_rows", () => {
  const ropa = read(ROPA);
  const without = (activity: string) =>
    ropa
      .split("\n")
      .filter((line) => !line.startsWith(`| ${activity} |`))
      .join("\n");
  expect(ropaProblems(without("Dev PDS `device` table"))).toEqual(["RoPA has no row for the dev PDS `device` table"]);
  expect(ropaProblems(without("Closed test track"))).toEqual(["RoPA has no row for the closed test track"]);
});

test("ai_record_has_required_fields", () => {
  const record = read(AI_RECORD);
  expect(aiRecordProblems(record, false)).toEqual([]);
  expect(AI_RECORD_MODELS).toEqual(["nudity", "gore", "Detoxify", "Llama Guard 3 1B", "whisper.cpp"]);
  const noRetention = record.replace(/^\| Retention \|.*\n/m, "");
  expect(aiRecordProblems(noRetention, false)).toEqual(["AI record has no Retention field"]);
  const noModel = record.replace(/^\| gore \|.*\n/m, "");
  expect(aiRecordProblems(noModel, false)).toEqual(["AI record has no row for the gore model"]);
  const emptyCell = record.replace(/^\| whisper\.cpp \| [^|]+\|/m, "| whisper.cpp | |");
  expect(aiRecordProblems(emptyCell, false)).toEqual(["AI record model whisper.cpp has an empty cell"]);
  const strict = aiRecordProblems(record, true);
  expect(strict.length).toBeGreaterThan(0);
  expect(strict.every((problem) => problem.endsWith("is TBD"))).toBe(true);
  expect(strict).toEqual(expect.arrayContaining(["AI record S4 rate is TBD", "AI record model gore is TBD"]));
  expect(AI_RECORD_FIELDS).toContain("Appeal route");
  if (STRICT) expect(strict).toEqual([]);
});
