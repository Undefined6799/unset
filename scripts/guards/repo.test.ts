// Every guard over the real repository, on every run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import * as alsoKnownAs from "./also-known-as.ts";
import * as caseCollision from "./case-collision.ts";
import * as compositionRoot from "./composition-root.ts";
import * as cookieDomain from "./cookie-domain.ts";
import * as cssLayers from "./css-layers.ts";
import * as egress from "./egress.ts";
import { type Finding, report } from "./files.ts";
import * as inlineStyle from "./inline-style.ts";
import * as innerHtml from "./inner-html.ts";
import * as ipColumns from "./ip-columns.ts";
import * as routeRegistration from "./route-registration.ts";
import * as webNoModerator from "./web-no-moderator.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES: [string, (root: string) => Finding[]][] = [
  ["egress", egress.scanAll],
  ["cookie-domain", cookieDomain.scanAll],
  ["inner-html", innerHtml.scanAll],
  ["inline-style", inlineStyle.scanAll],
  ["css-layers", cssLayers.scanAll],
  ["web-no-moderator", webNoModerator.scanAll],
  ["ip-columns", ipColumns.scanAll],
  ["route-registration", routeRegistration.scanAll],
  ["composition-root", compositionRoot.scanAll],
  ["case-collision", caseCollision.scanAll],
  ["also-known-as", alsoKnownAs.scanAll],
];

describe("repo_clean", () => {
  test.each(RULES)("%s", (_rule, scanAll) => {
    const findings = scanAll(ROOT);
    expect(findings, report(findings)).toEqual([]);
  });
});

test("also_known_as_scans_files", () => {
  // An empty scan would pass vacuously: the guard must have read the product folders.
  expect(alsoKnownAs.scannedFiles(ROOT).length).toBeGreaterThan(0);
});

test("css_layers_scans_files", () => {
  // AB-4: an empty scan would pass vacuously; shared/ui's layers.css and tokens.css exist from P1.21.
  expect(cssLayers.scannedFiles(ROOT).length).toBeGreaterThan(0);
});

test("report_format", () => {
  expect(report([{ file: "a.ts", line: 3, rule: "egress", text: "fetch(u)" }])).toBe("a.ts:3  [egress]  fetch(u)");
});

test("unreadable_file_is_finding", () => {
  const invalid = new Uint8Array([0x63, 0x6f, 0xff, 0xfe, 0x0a]);
  const scanned: Record<string, string> = {
    "ip-columns": "infrastructure/postgres/migrations/0001.sql",
    "composition-root": "interfaces/http/main.ts",
    "inline-style": "apps/web/src/Bad.tsx",
    "css-layers": "apps/web/src/screens/Bad.module.css",
  };
  // case-collision reads only names from git, never file contents.
  for (const [rule, scanAll] of RULES.filter(([rule]) => rule !== "case-collision")) {
    const root = mkdtempSync(join(tmpdir(), "guards-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const file = scanned[rule] ?? "apps/web/src/bad.ts";
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), invalid);
    expect(scanAll(root), rule).toEqual([{ file, line: 1, rule, text: "unreadable" }]);
  }
});
