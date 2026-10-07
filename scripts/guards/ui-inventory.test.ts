// The UI inventory guard (P1.24q) against a copy of the real shared/ui, with one failure planted per case (AB-4).
// Source fixtures sit in fixtures/ui-inventory/{bad,good}; JSON and SVG plants are written here, since they cannot
// carry a fixture header line.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { report } from "./files.ts";
import { INVENTORY, scanAll } from "./ui-inventory.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const FIXTURES = join(import.meta.dirname, "fixtures", "ui-inventory");
const HEADER = /^\/\/\s*fixture:\s*(\S+)\s+findings=(\d+)\s*$/;
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A temp repo holding the real shared/ui (sources, inventory, sheet copy and icons) and nothing else. */
function base(): string {
  const root = mkdtempSync(join(tmpdir(), "ui-inventory-"));
  temps.push(root);
  cpSync(join(ROOT, "shared", "ui"), join(root, "shared", "ui"), {
    recursive: true,
    filter: (src) => !/[/\\](?:node_modules|dist)$/.test(src),
  });
  return root;
}

function write(root: string, file: string, body: string | Buffer): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), body);
}

function editJson(root: string, file: string, edit: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, unknown>;
  edit(value);
  write(root, file, JSON.stringify(value));
}

/** Plants the named fixture into `root`; returns its target path and the findings its header expects. */
function plant(root: string, kind: "bad" | "good", name: string): { path: string; count: number } {
  const text = readFileSync(join(FIXTURES, kind, name), "utf8");
  const [, path = "", count = "-1"] = HEADER.exec(text.split("\n")[0] ?? "") ?? [];
  expect(path, `${kind}/${name} header`).not.toBe("");
  write(root, path, text);
  return { path, count: Number(count) };
}

const texts = (root: string): string[] => scanAll(root).map((f) => `${f.file}: ${f.text}`);
const ICON = "shared/ui/icons/svg/next.svg.txt";

describe("ui-inventory", () => {
  test("ui_inventory_base_is_clean", () => {
    const findings = scanAll(base());
    expect(findings, report(findings)).toEqual([]);
  });

  test("ui_inventory_good_fixtures", () => {
    const root = base();
    for (const name of readdirSync(join(FIXTURES, "good"))) plant(root, "good", name);
    expect(texts(root)).toEqual([]);
  });

  test.each(["icon-package.fixture", "unknown-icon.fixture", "inline-svg.fixture"])("ui_inventory_bad_%s", (name) => {
    const root = base();
    const { path, count } = plant(root, "bad", name);
    const findings = scanAll(root);
    expect(
      findings.every((f) => f.file === path),
      report(findings),
    ).toBe(true);
    expect(findings).toHaveLength(count);
  });

  test("inventory_unknown_component_fails", () => {
    const root = base();
    write(root, "shared/ui/components/Fancy/Fancy.tsx", "export const Fancy = () => null;\n");
    expect(texts(root)).toEqual(["shared/ui/components/Fancy: not in inventory.json"]);
  });

  test("inventory_built_without_folder_fails", () => {
    const root = base();
    rmSync(join(root, "shared/ui/components/Kbd"), { recursive: true });
    expect(texts(root)).toEqual([`${INVENTORY}: Kbd is built but shared/ui/components/Kbd does not exist`]);
  });

  test("inventory_sheet_readme_changed_fails", () => {
    const root = base();
    const readme = join(root, "shared/ui/sheet/components/Button/README.md");
    writeFileSync(readme, `${readFileSync(readme, "utf8")}\nA new variant.\n`);
    expect(texts(root)).toEqual([
      "shared/ui/sheet/components/Button/README.md: Button: sheet README changed since recorded; re-review and update sheetSha256",
    ]);
  });

  test("inventory_stop_item_used_fails", () => {
    const root = base();
    editJson(root, INVENTORY, (inventory) => {
      (inventory.Toast as { status: string }).status = "stop";
    });
    const { path, count } = plant(root, "bad", "stop-item.fixture");
    const findings = scanAll(root);
    expect(findings.map((f) => f.file)).toEqual(Array(count).fill(path));
  });

  test("no_icon_packages_in_manifests_or_lockfile", () => {
    const root = base();
    write(root, "apps/web/package.json", JSON.stringify({ dependencies: { "lucide-react": "1.0.0" } }));
    write(root, "package.json", JSON.stringify({ devDependencies: { iconoir: "7.12.1" } }));
    write(root, "package-lock.json", JSON.stringify({ packages: { "node_modules/@heroicons/react": {} } }));
    expect(texts(root)).toEqual([
      "apps/web/package.json: icon package lucide-react in dependencies",
      "package-lock.json: icon package @heroicons/react locked",
      "package.json: icon package iconoir in devDependencies",
    ]);
  });

  test("icon_not_on_sheet_fails", () => {
    const root = base();
    write(root, "shared/ui/icons/svg/rocket.svg.txt", readFileSync(join(root, ICON)));
    write(root, "shared/ui/icons/svg/rocket.svg", readFileSync(join(root, ICON)));
    expect(texts(root)).toEqual([
      "shared/ui/icons/svg/rocket.svg: not on the sheet's Icon list in icons.json",
      "shared/ui/icons/svg/rocket.svg.txt: not on the sheet's Icon list in icons.json",
    ]);
  });

  test("icon_svg_hash_mismatch_fails", () => {
    const root = base();
    write(root, ICON, readFileSync(join(root, ICON), "utf8").replace("M3 12", "M4 12"));
    expect(texts(root)).toEqual([`${ICON}: sha256 differs from icons.json`]);
  });

  test.each([
    ["script", "<script>alert(1)</script>"],
    ["onload", '<g onload="alert(1)"></g>'],
    ["href", '<use href="#a"></use>'],
    ["xlink", '<use xlink:href="#a"></use>'],
    ["style", "<style>path{}</style>"],
  ])("icon_svg_unsafe_content_fails_%s", (_name, planted) => {
    const root = base();
    write(root, ICON, readFileSync(join(root, ICON), "utf8").replace("</svg>", `${planted}</svg>`));
    expect(texts(root)).toEqual([
      `${ICON}: sha256 differs from icons.json`,
      `${ICON}: script, style, foreignObject, on* or href`,
    ]);
  });

  test("icon_missing_and_version_pin", () => {
    const root = base();
    rmSync(join(root, ICON));
    editJson(root, "shared/ui/icons/icons.json", (icons) => {
      icons.iconoirVersion = "7.13.0";
    });
    expect(texts(root)).toEqual([
      "shared/ui/icons/icons.json: iconoirVersion 7.13.0 is not the sheet's 7.12.1",
      "shared/ui/icons/icons.json: next: shared/ui/icons/svg/next.svg.txt missing",
    ]);
  });

  test("svg_file_outside_icons_fails", () => {
    const root = base();
    write(root, "apps/web/public/logo.svg", "<svg></svg>");
    write(root, "docs/human/assets/banner.svg", "<svg></svg>");
    expect(texts(root)).toEqual(["apps/web/public/logo.svg: SVG file outside shared/ui/icons/svg"]);
  });

  test("unreadable_inventory_is_one_finding", () => {
    const root = base();
    writeFileSync(join(root, INVENTORY), "{ not json");
    expect(texts(root)).toEqual([`${INVENTORY}: unreadable`]);
  });
});
