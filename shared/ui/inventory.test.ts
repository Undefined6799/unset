// The sheet inventory (P1.24i; step book record 2026-10-06-p124-split.md): inventory.json lists every component the
// sheet publishes, at the README bytes recorded from it, and every piece the plan needed that the sheet first lacked
// is in docs/human/ui/stop-items.md with Alex's dated approval before it is built. scripts/guards/ui-inventory.ts
// (P1.24q) turns the rest of the book's rules into a CI check.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const UI = import.meta.dirname;
const STOP_ITEMS = join(UI, "..", "..", "docs", "human", "ui", "stop-items.md");
type Entry = {
  sheet: string;
  sheetSha256: string;
  props: string;
  variants: string[];
  status: string;
  extensions?: { path: string; sha256: string }[];
};
const inventory = JSON.parse(readFileSync(join(UI, "inventory.json"), "utf8")) as Record<string, Entry>;
/** Since P1.20k the inventory is sheet reference data: the React kit that built each piece is gone (ADR 0055). */
const STATUSES = ["reference"];

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
    else if (item.approval === null) problems.push(`${item.name}: no dated approval`);
  }
  return problems;
}

test("inventory_covers_sheet", () => {
  const source = JSON.parse(readFileSync(join(UI, "sheet", "source.json"), "utf8")) as {
    files: { path: string; sha256: string }[];
  };
  const dts = readFileSync(join(UI, "sheet", "components-index.d.ts.txt"), "utf8");
  const sheet = readdirSync(join(UI, "sheet", "components")).sort();
  const imported = Object.entries(inventory).filter(([name]) => name !== "Navigation");
  expect(imported.map(([name]) => name).sort()).toEqual(sheet);
  expect(sheet).toHaveLength(34);
  for (const [name, entry] of imported) {
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

test("inventory_registers_the_approved_navigation_extension", () => {
  const extensions = Object.entries(inventory).filter(([, entry]) => !entry.sheet.startsWith("sheet/"));
  expect(extensions.map(([name]) => name)).toEqual(["Navigation"]);
  const readme = "components/Navigation/README.md";
  expect(inventory.Navigation).toEqual({
    sheet: readme,
    sheetSha256: createHash("sha256")
      .update(readFileSync(join(UI, readme)))
      .digest("hex"),
    props: "NavigationProps",
    variants: ["left drawer", "phone floating bar"],
    status: "reference",
    extensions: [
      {
        path: "approved-extensions.json",
        sha256: createHash("sha256")
          .update(readFileSync(join(UI, "approved-extensions.json")))
          .digest("hex"),
      },
    ],
  });
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
  // Every recorded piece carries Alex's dated approval and is in the inventory.
  const line = "- **Avatar** · needed by P1.24s · sheet draft: https://claude.ai/artifact/x · not yet approved";
  expect(stopItemProblems(line, { Avatar: { status: "reference" } })).toEqual(["Avatar: no dated approval"]);
  expect(stopItemProblems(line, {})).toEqual(["Avatar: not in inventory.json"]);
});

test("icon_approval_recorded", () => {
  expect(inventory.Icon?.status).toBe("reference");
  const icon = items(readFileSync(STOP_ITEMS, "utf8")).find((i) => i.name === "Icon");
  expect(icon?.approval?.slice(1)).toEqual(["2026-10-03", "18:02", "34"]);
});

test("inventory_all_reference", () => {
  // The 34 sheet pieces and the approved Navigation, all reference data since the React kit went (P1.20k).
  const statuses = Object.values(inventory).map((entry) => entry.status);
  expect(statuses.filter((status) => status === "reference")).toHaveLength(35);
});

test("approved_extension_pointers_preserve_the_imported_inventory", () => {
  const registered = Object.entries(inventory).filter(([, entry]) => entry.extensions !== undefined);
  expect(registered.map(([name]) => name).sort()).toEqual(["Button", "Header", "Icon", "Navigation"]);
  const sha256 = createHash("sha256")
    .update(readFileSync(join(UI, "approved-extensions.json")))
    .digest("hex");
  for (const [, entry] of registered) expect(entry.extensions).toEqual([{ path: "approved-extensions.json", sha256 }]);
  expect(Object.keys(inventory)).toHaveLength(35);
});
