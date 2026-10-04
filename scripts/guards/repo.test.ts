// Every guard over the real repository, on every run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import * as cookieDomain from "./cookie-domain.ts";
import * as egress from "./egress.ts";
import { type Finding, report } from "./files.ts";
import * as innerHtml from "./inner-html.ts";
import * as ipColumns from "./ip-columns.ts";
import * as webNoModerator from "./web-no-moderator.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES: [string, (root: string) => Finding[]][] = [
  ["egress", egress.scanAll],
  ["cookie-domain", cookieDomain.scanAll],
  ["inner-html", innerHtml.scanAll],
  ["web-no-moderator", webNoModerator.scanAll],
  ["ip-columns", ipColumns.scanAll],
];

describe("repo_clean", () => {
  test.each(RULES)("%s", (_rule, scanAll) => {
    const findings = scanAll(ROOT);
    expect(findings, report(findings)).toEqual([]);
  });
});

test("report_format", () => {
  expect(report([{ file: "a.ts", line: 3, rule: "egress", text: "fetch(u)" }])).toBe("a.ts:3  [egress]  fetch(u)");
});

test("unreadable_file_is_finding", () => {
  const root = mkdtempSync(join(tmpdir(), "guards-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const invalid = new Uint8Array([0x63, 0x6f, 0xff, 0xfe, 0x0a]);
  for (const file of ["apps/web/src/bad.ts", "infrastructure/postgres/migrations/0001.sql"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), invalid);
  }
  for (const [rule, scanAll] of RULES) {
    const file = rule === "ip-columns" ? "infrastructure/postgres/migrations/0001.sql" : "apps/web/src/bad.ts";
    expect(scanAll(root), rule).toEqual([{ file, line: 1, rule, text: "unreadable" }]);
  }
});
