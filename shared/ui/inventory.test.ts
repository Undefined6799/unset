// The sheet inventory (P1.24i; step book record 2026-10-06-p124-split.md): inventory.json lists every component the
// sheet publishes, at the README bytes recorded from it, and every piece the plan needed that the sheet first lacked
// is in docs/human/ui/stop-items.md with Alex's dated approval before it is built. scripts/guards/ui-inventory.ts
// (P1.24q) turns the rest of the book's rules into a CI check.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const UI = import.meta.dirname;
const STOP_ITEMS = join(UI, "..", "..", "docs", "human", "ui", "stop-items.md");
type Entry = { sheet: string; sheetSha256: string; props: string; variants: string[]; status: string };
const inventory = JSON.parse(readFileSync(join(UI, "inventory.json"), "utf8")) as Record<string, Entry>;
const STATUSES = ["built", "p1.24", "p1.24s", "p1.24a", "p1.24k", "stop"];

/** One "- **Name** · needed by <step> · … · approved by Alex <date>" line per piece; approval is optional in shape. */
const ITEM = /^- \*\*(\w+)\*\* · needed by (P\d\.\d+[a-z]?) · sheet draft: (\S+) · (.*)$/;
const APPROVED = /^approved by Alex (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2})Z)?, sheet v(\d+)$/;
const items = (doc: string) =>
  doc
    .split("\n")
    .filter((line) => line.startsWith("- **"))
    .map((line) => {
      const m = ITEM.exec(line);
      if (m === null) throw new Error(`stop-items.md line is not in the item format: ${line}`);
      return {
        name: m[1] as string,
        step: m[2] as string,
        draft: m[3] as string,
        approval: APPROVED.exec(m[4] as string),
      };
    });

/** Problems with a stop-items list against an inventory; empty when every rule holds. */
function stopItemProblems(doc: string, inv: Record<string, Pick<Entry, "status">>): string[] {
  const problems: string[] = [];
  for (const item of items(doc)) {
    if (inv[item.name] === undefined) problems.push(`${item.name}: not in inventory.json`);
    else if (item.approval === null && inv[item.name]?.status !== "stop")
      problems.push(`${item.name}: status ${inv[item.name]?.status} without a dated approval`);
  }
  for (const [name, entry] of Object.entries(inv))
    if (entry.status === "stop" && !items(doc).some((i) => i.name === name))
      problems.push(`${name}: a stop item missing from stop-items.md`);
  return problems;
}

test("inventory_covers_sheet", () => {
  const source = JSON.parse(readFileSync(join(UI, "sheet", "source.json"), "utf8")) as {
    files: { path: string; sha256: string }[];
  };
  const dts = readFileSync(join(UI, "sheet", "components-index.d.ts.txt"), "utf8");
  const sheet = readdirSync(join(UI, "sheet", "components")).sort();
  expect(Object.keys(inventory).sort()).toEqual(sheet);
  expect(sheet).toHaveLength(33);
  for (const [name, entry] of Object.entries(inventory)) {
    expect(entry.sheet).toBe(`sheet/components/${name}/README.md`);
    expect(entry.sheetSha256, name).toBe(source.files.find((f) => f.path === entry.sheet)?.sha256);
    expect(STATUSES, name).toContain(entry.status);
    if (entry.props === "inline") expect(dts, name).toContain(`export declare function ${name}(props: {`);
    else expect(dts, name).toMatch(new RegExp(`export interface ${entry.props}\\b`));
    for (const variant of entry.variants) {
      const [prop, value] = variant.split("=") as [string, string];
      expect(dts, `${name} ${variant}`).toMatch(
        new RegExp(`${prop}\\??: [^;\\n]*\\b${value.replace(/[:]/g, "\\:")}\\b`),
      );
    }
  }
});

test("stop_items_doc_exists", () => {
  const doc = readFileSync(STOP_ITEMS, "utf8");
  expect(doc).toMatch(/^# UI stop items\n/);
  expect(items(doc).length).toBeGreaterThan(0);
  for (const item of items(doc)) expect(item.draft, item.name).toMatch(/^https:\/\/claude\.ai\/artifact\/\w+$/);
});

test("stop_item_needs_dated_approval", () => {
  const doc = readFileSync(STOP_ITEMS, "utf8");
  expect(stopItemProblems(doc, inventory)).toEqual([]);
  // A piece built (or booked to be built) without Alex's dated approval fails; one still marked stop does not.
  const line = "- **Avatar** · needed by P1.24s · sheet draft: https://claude.ai/artifact/x · not yet approved";
  expect(stopItemProblems(line, { Avatar: { status: "p1.24s" } })).toEqual([
    "Avatar: status p1.24s without a dated approval",
  ]);
  expect(stopItemProblems(line, { Avatar: { status: "stop" } })).toEqual([]);
  expect(stopItemProblems("", { Avatar: { status: "stop" } })).toEqual([
    "Avatar: a stop item missing from stop-items.md",
  ]);
});

test("icon_approval_recorded", () => {
  expect(inventory.Icon?.status).toBe("built");
  const icon = items(readFileSync(STOP_ITEMS, "utf8")).find((i) => i.name === "Icon");
  expect(icon?.approval?.slice(1)).toEqual(["2026-10-03", "18:02", "34"]);
});
