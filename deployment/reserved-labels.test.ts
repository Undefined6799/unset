// P0.11 reserved_labels_format: the handle labels no account may take (plan §5.2). pds-admin enforces the list at
// P2.09; this test keeps the data well-formed until then.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const LABEL = /^(_\*|xn--\*|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)$/;
const PLAN_LABELS = ["www", "api", "admin", "account", "mail", "mta-sts", "autoconfig", "status", "_*"];

/** Non-comment, non-blank lines; a `#` starts a comment anywhere on a line. */
function labels(text: string): string[] {
  return text
    .split("\n")
    .map((line) => (line.split("#")[0] ?? "").trim())
    .filter((line) => line !== "");
}

/** Every problem with the list, empty when it is well-formed. */
function labelProblems(list: string[]): string[] {
  const problems = list.filter((l) => !LABEL.test(l)).map((l) => `malformed label ${JSON.stringify(l)}`);
  for (const l of PLAN_LABELS) if (!list.includes(l)) problems.push(`missing plan label ${l}`);
  const seen = new Set<string>();
  for (const l of list) {
    if (seen.has(l)) problems.push(`duplicate label ${l}`);
    seen.add(l);
  }
  return problems;
}

test("reserved_labels_format", () => {
  const list = labels(readFileSync(join(import.meta.dirname, "reserved-labels.txt"), "utf8"));
  expect(labelProblems(list)).toEqual([]);
  expect(labelProblems([...PLAN_LABELS, "Admin", "-a", "a_b", `${"a".repeat(64)}`, "www"])).toEqual([
    'malformed label "Admin"',
    'malformed label "-a"',
    'malformed label "a_b"',
    `malformed label "${"a".repeat(64)}"`,
    "duplicate label www",
  ]);
  expect(labelProblems(["www"])).toContain("missing plan label _*");
  expect(labels("# head\nwww  # web\n\n  api\n")).toEqual(["www", "api"]);
});
