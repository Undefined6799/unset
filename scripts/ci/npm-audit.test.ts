import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type AuditReport, auditProblems, MAX_DAYS } from "./npm-audit.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const TODAY = new Date("2026-10-23T00:00:00Z");
const ID = "GHSA-mrhx-c7xc-m3w5";
const INSTALLED = { "node_modules/zod": "3.25.76", "node_modules/@atproto/did": "0.5.6" };

const advisory = (severity: string, id = ID) => ({
  name: "zod",
  url: `https://github.com/advisories/${id}`,
  severity,
  title: "Zod can exhaust memory",
});
const report = (...via: ReturnType<typeof advisory>[]): AuditReport => ({
  auditReportVersion: 2,
  vulnerabilities: {
    zod: { via, nodes: ["node_modules/zod"] },
    "@atproto/did": { via: ["zod"], nodes: ["node_modules/@atproto/did"] },
  },
});
const ignore = (fields: Record<string, string> = {}) => {
  const entry = {
    id: ID,
    package: "zod",
    versions: '["3.25.76"]',
    statement: "not reachable",
    expired_at: "2026-11-20",
    ...fields,
  };
  const lines = Object.entries(entry).flatMap(([key, value]) => (value === "" ? [] : [`    ${key}: ${value}`]));
  return `advisories:\n  - ${lines.join("\n").trimStart()}\n`;
};

describe("npm audit gate (P0.07i)", () => {
  test("npm_audit_unaccepted_high_fails", () => {
    expect(auditProblems(report(advisory("high")), "advisories: []\n", INSTALLED, TODAY)).toEqual([
      `${ID} (zod, high): Zod can exhaust memory`,
    ]);
    expect(auditProblems(report(advisory("critical", "GHSA-aaaa-bbbb-cccc")), ignore(), INSTALLED, TODAY)).toEqual([
      "GHSA-aaaa-bbbb-cccc (zod, critical): Zod can exhaust memory",
      `${ID}: matches nothing, remove it`,
    ]);
    expect(auditProblems(report(advisory("moderate")), "advisories: []\n", INSTALLED, TODAY)).toEqual([]);
    expect(auditProblems({}, "advisories: []\n", INSTALLED, TODAY)).toEqual([
      "npm audit --json: not auditReportVersion 2",
    ]);
  });

  test("npm_audit_entry_scoped_to_package_and_versions", () => {
    expect(auditProblems(report(advisory("high")), ignore(), INSTALLED, TODAY)).toEqual([]);
    expect(auditProblems(report(advisory("high")), ignore({ versions: '["3.25.75"]' }), INSTALLED, TODAY)).toEqual([
      `${ID} (zod, high): Zod can exhaust memory: version 3.25.76 is not accepted`,
    ]);
    expect(auditProblems(report(advisory("high")), ignore({ package: "zod-mini" }), INSTALLED, TODAY)).toEqual([
      `${ID} (zod, high): Zod can exhaust memory: accepted for package zod-mini only`,
    ]);
    expect(auditProblems(report(), ignore(), INSTALLED, TODAY)).toEqual([`${ID}: matches nothing, remove it`]);
  });

  test("npm_audit_entry_expiry_enforced", () => {
    const run = (fields: Record<string, string>) =>
      auditProblems(report(advisory("high")), ignore(fields), INSTALLED, TODAY);
    expect(run({ expired_at: "2026-10-23" })).toEqual([`${ID}: expired on 2026-10-23`]);
    expect(run({ expired_at: "2026-12-01" })).toEqual([
      `${ID}: expired_at 2026-12-01 is more than ${MAX_DAYS} days ahead`,
    ]);
    expect(run({ expired_at: "" })).toEqual([`${ID}: no expired_at`]);
    expect(run({ statement: "" })).toEqual([`${ID}: no statement`]);
    expect(run({ versions: "[]" })).toEqual([`${ID}: no exact versions`]);
    expect(run({ id: "CVE-2026-1" })).toEqual(["entry 1: no GHSA id"]);
  });

  test("npm_audit_ignore_file_valid", () => {
    const yaml = readFileSync(join(ROOT, ".github", "npm-audit-ignore.yaml"), "utf8");
    expect(auditProblems(report(advisory("high")), yaml, INSTALLED, new Date())).toEqual([]);
  });
});
