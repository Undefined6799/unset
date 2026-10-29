// The icon build (P1.24i; architecture record 2026-10-06-p116-retention-usage-and-p124-icon-source.md, follow-up
// 20:10Z): the committed Iconoir files equal the sheet's ICONS data, the sheet's bundle is parsed and never run, and
// nothing outside the element and attribute allowlist gets through.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import {
  APPROVED_EXTENSION_SHA256,
  ICONOIR_VERSION,
  type IconsIo,
  parseSvg,
  runIcons,
  sheetDrawings,
} from "./icons.ts";

const UI = join(import.meta.dirname, "..", "ui");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A copy of shared/ui's icon inputs and output, to break without touching the repository. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "icons-"));
  temps.push(root);
  for (const dir of ["sheet", "icons", "inventory.json"]) cpSync(join(UI, dir), join(root, dir), { recursive: true });
  if (existsSync(join(UI, "approved-extensions.json")))
    cpSync(join(UI, "approved-extensions.json"), join(root, "approved-extensions.json"));
  return root;
}
/** node:fs bound to one shared/ui root, as scripts/ui/icons.ts binds it. */
const fileIo = (root: string): IconsIo => ({
  readText: (path) => readFileSync(join(root, path), "utf8"),
  sha256: (path) =>
    createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex"),
  list: (dir) => readdirSync(join(root, dir)),
  writeText: (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  },
});
const run = (root: string, args: string[]) => {
  const lines: string[] = [];
  return { code: runIcons(args, fileIo(root), (l) => lines.push(l)), lines };
};
/** Rewrites one file in a copy and records its new hash in source.json, so only the check under test can fail. */
function rewrite(root: string, path: string, edit: (text: string) => string): void {
  writeFileSync(join(root, path), edit(readFileSync(join(root, path), "utf8")));
  const source = JSON.parse(readFileSync(join(root, "sheet/source.json"), "utf8"));
  for (const file of source.files) if (file.path === path) file.sha256 = fileIo(root).sha256(path);
  writeFileSync(join(root, "sheet/source.json"), JSON.stringify(source));
}
const code = (result: { lines: string[] }) => result.lines.map((l) => l.split(":")[0]);

test("icon_allowlist_matches_sheet", () => {
  const result = run(UI, ["--check"]);
  expect(result.lines).toEqual([]);
  expect(result.code).toBe(0);
  const json = JSON.parse(readFileSync(join(UI, "icons/icons.json"), "utf8"));
  expect(json.iconoirVersion).toBe("7.12.1");
  expect(ICONOIR_VERSION).toBe("7.12.1");
  expect(Object.keys(json.icons)).toHaveLength(41);
  const licence = readFileSync(join(UI, "icons/LICENSE-iconoir.txt"), "utf8");
  expect(licence).toMatch(/^MIT License/);
  expect(licence).toContain("Copyright (c) 2021 Luca Burgio");
});

test("icon_drawing_module_missing_or_extra_fails", () => {
  const missing = copy();
  rmSync(join(missing, "icons/drawings/close.generated.ts"));
  expect(code(run(missing, ["--check"]))).toEqual(["icons.stale"]);
  expect(run(missing, []).code).toBe(0);
  expect(run(missing, ["--check"]).code).toBe(0);

  const edited = copy();
  writeFileSync(join(edited, "icons/drawings/close.generated.ts"), "export default [];\n");
  expect(code(run(edited, ["--check"]))).toEqual(["icons.stale"]);

  const extra = copy();
  writeFileSync(join(extra, "icons/drawings/arrow.generated.ts"), "export default [];\n");
  expect(code(run(extra, ["--check"]))).toEqual(["icons.stale"]);
  expect(code(run(extra, []))).toEqual(["icons.stale"]);
});

test("icon_check_detects_stale_output", () => {
  const root = copy();
  writeFileSync(join(root, "icons/icons.json"), "{}\n");
  expect(code(run(root, ["--check"]))).toEqual(["icons.stale"]);
  expect(run(root, []).code).toBe(0);
  expect(run(root, ["--check"]).code).toBe(0);
});

test("icon_bundle_hash_pinned", () => {
  const root = copy();
  writeFileSync(join(root, "sheet/bundle.js.txt"), `${readFileSync(join(root, "sheet/bundle.js.txt"), "utf8")}\n`);
  expect(code(run(root, ["--check"]))).toEqual(["icons.source_mismatch"]);
});

test("icon_drawing_differs_from_sheet_fails", () => {
  const root = copy();
  writeFileSync(
    join(root, "icons/svg/next.svg.txt"),
    readFileSync(join(root, "icons/svg/next.svg.txt"), "utf8").replace("M3 12", "M4 12"),
  );
  expect(code(run(root, ["--check"]))).toEqual(["icons.drawing_mismatch"]);
});

test("icon_list_must_equal_readme", () => {
  const extra = copy();
  cpSync(join(extra, "icons/svg/next.svg.txt"), join(extra, "icons/svg/arrow.svg.txt"));
  expect(code(run(extra, ["--check"]))).toEqual(["icons.list_mismatch"]);

  const short = copy();
  rewrite(short, "sheet/components/Icon/README.md", (t) => t.replace(/^\| `signout` .*\n/m, ""));
  expect(code(run(short, ["--check"]))).toEqual(["icons.parse"]);
});

test("icons_bundle_not_executed", () => {
  const marker = "__iconsBundleRan";
  const g = globalThis as Record<string, unknown>;
  const bundle = (icons: string) =>
    `globalThis.${marker} = true;\n(function () {\n  var ICONS = ${icons};\n  globalThis.${marker} = true;\n})();\n`;
  // A literal ICONS parses, and the code around it is never run.
  expect(sheetDrawings(bundle('{"next": [["path", {"d": "M0 0"}]]}'))).toEqual({ next: [["path", { d: "M0 0" }]] });
  // Anything that is not a literal fails: a call, a computed key, a spread, a template, an identifier.
  for (const icons of [
    `{"next": (globalThis.${marker} = true)}`,
    `{[globalThis.${marker} = "next"]: []}`,
    `{...globalThis}`,
    '{"next": [[`path`, {}]]}',
    '{"next": [["path", {"d": D}]]}',
  ])
    expect(() => sheetDrawings(bundle(icons)), icons).toThrow(/icons\.parse/);
  expect(g[marker]).toBeUndefined();
});

test("icons_bundle_slice_boundaries", () => {
  expect(sheetDrawings('var ICONS = {"a": []};\nvar X = 1;\n')).toEqual({ a: [] });
  for (const bundle of [
    'var ICON = {"a": []};\n',
    'var ICONS = {"a": []}',
    'var ICONS = {"a": []};\nvar ICONS = {"b": []};\n',
    'var ICONS = {"a": []}; foo();\n',
  ])
    expect(() => sheetDrawings(bundle), bundle).toThrow(/icons\.parse/);
});

test("icon_svg_allowlist_enforced", () => {
  const root =
    '<svg width="24" height="24" viewBox="0 0 24 24" stroke-width="1.5" fill="none" xmlns="http://www.w3.org/2000/svg">';
  const path = '<path d="M0 0" stroke="currentColor"/>';
  expect(parseSvg("ok", `${root}\n${path}\n</svg>\n`)).toEqual([["path", { d: "M0 0", stroke: "currentColor" }]]);
  for (const body of [
    "<script>alert(1)</script>",
    '<path d="M0 0" onload="alert(1)"/>',
    '<path d="M0 0" style="fill:red"/>',
    '<path d="M0 0" href="https://example.com/"/>',
    '<use href="#a"/>',
    "<foreignObject></foreignObject>",
    '<image href="x.png"/>',
  ])
    expect(() => parseSvg("bad", `${root}\n${body}\n</svg>\n`), body).toThrow(/icons\.drawing_mismatch/);
  expect(() => parseSvg("bad", `${root.replace("<svg ", '<svg onload="x" ')}\n${path}\n</svg>\n`)).toThrow(
    /icons\.drawing_mismatch/,
  );
  // The sheet side is held to the same allowlist.
  for (const icons of [
    '{"next": [["script", {}]]}',
    '{"next": [["path", {"onClick": "x"}]]}',
    '{"next": [["path", {"style": "x"}]]}',
  ])
    expect(() => sheetDrawings(`var ICONS = ${icons};\n`), icons).toThrow(/icons\.parse/);
});

// Exact official Iconoir 7.12.1 source bytes for the registered icons, independent of the files under test.
const ADDITIONS: Record<string, string> = {
  devices:
    '<svg width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M2 21L17 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M21 21L22 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M2 16.4V3.6C2 3.26863 2.26863 3 2.6 3H21.4C21.7314 3 22 3.26863 22 3.6V16.4C22 16.7314 21.7314 17 21.4 17H2.6C2.26863 17 2 16.7314 2 16.4Z" stroke="currentColor" stroke-width="1.5"/>\n</svg>\n',
  apps: '<svg width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M14 20.4V14.6C14 14.2686 14.2686 14 14.6 14H20.4C20.7314 14 21 14.2686 21 14.6V20.4C21 20.7314 20.7314 21 20.4 21H14.6C14.2686 21 14 20.7314 14 20.4Z" stroke="currentColor" stroke-width="1.5"/>\n<path d="M3 20.4V14.6C3 14.2686 3.26863 14 3.6 14H9.4C9.73137 14 10 14.2686 10 14.6V20.4C10 20.7314 9.73137 21 9.4 21H3.6C3.26863 21 3 20.7314 3 20.4Z" stroke="currentColor" stroke-width="1.5"/>\n<path d="M14 9.4V3.6C14 3.26863 14.2686 3 14.6 3H20.4C20.7314 3 21 3.26863 21 3.6V9.4C21 9.73137 20.7314 10 20.4 10H14.6C14.2686 10 14 9.73137 14 9.4Z" stroke="currentColor" stroke-width="1.5"/>\n<path d="M3 9.4V3.6C3 3.26863 3.26863 3 3.6 3H9.4C9.73137 3 10 3.26863 10 3.6V9.4C10 9.73137 9.73137 10 9.4 10H3.6C3.26863 10 3 9.73137 3 9.4Z" stroke="currentColor" stroke-width="1.5"/>\n</svg>\n',
  "bulb-off":
    '<svg width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M9 18H15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M10 21H14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M9.00082 15C9.00098 13 8.50098 12.5 7.50082 11.5C6.50067 10.5 6.02422 9.48689 6.00082 8C5.95284 4.95029 8.00067 3 12.0008 3C16.001 3 18.0488 4.95029 18.0008 8C17.9774 9.48689 17.5007 10.5 16.5008 11.5C15.501 12.5 15.001 13 15.0008 15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>\n',
  "bulb-on":
    '<svg width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M21 2L20 3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M3 2L4 3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M21 16L20 15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M3 16L4 15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M9 18H15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M10 21H14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M11.9998 3C7.9997 3 5.95186 4.95029 5.99985 8C6.02324 9.48689 6.4997 10.5 7.49985 11.5C8.5 12.5 9 13 8.99985 15H14.9998C15 13.0001 15.5 12.5 16.4997 11.5001L16.4998 11.5C17.4997 10.5 17.9765 9.48689 17.9998 8C18.0478 4.95029 16 3 11.9998 3Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>\n',
  tv: '<svg width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M7 21L17 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M2 16.4V3.6C2 3.26863 2.26863 3 2.6 3H21.4C21.7314 3 22 3.26863 22 3.6V16.4C22 16.7314 21.7314 17 21.4 17H2.6C2.26863 17 2 16.7314 2 16.4Z" stroke="currentColor" stroke-width="1.5"/>\n</svg>\n',
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const APPROVED_TEXT = readFileSync(join(UI, "approved-extensions.json"), "utf8");
const REGISTRATION = JSON.parse(APPROVED_TEXT) as {
  designApproval: unknown;
  icons: Record<
    "devices" | "apps" | "bulb-off" | "bulb-on" | "tv",
    { sourceSha256: string; drawings: [string, Record<string, string>][] }
  >;
};
// Recorded from the last absent-pointer commit, 18291e6; never derived with the generator under test.
const LEGACY_JSON_SHA256 = "3fe0bffbccf8fee5630e762fea71aa5391be5b494c74b70a089e0bbf8db2bbee";
const LEGACY_MODULES_SHA256 = "419a9455e85d2135b72ab5ed1c1bb765761ecd33bef5602e385a6de839278476";

/** Explicit imported-sheet fixture: remove the two additions from today's product snapshot, never from the sheet. */
function baseFiles(): Map<string, string> {
  const paths = [
    "sheet/source.json",
    "sheet/components/Icon/README.md",
    "sheet/bundle.js.txt",
    "inventory.json",
    "icons/icons.json",
    ...["icons/svg", "icons/drawings"].flatMap((dir) => readdirSync(join(UI, dir)).map((name) => `${dir}/${name}`)),
  ];
  const files = new Map(paths.map((path) => [path, readFileSync(join(UI, path), "utf8")]));
  const inventory = JSON.parse(files.get("inventory.json") as string);
  delete inventory.Icon.extensions;
  files.set("inventory.json", JSON.stringify(inventory));
  const json = JSON.parse(files.get("icons/icons.json") as string);
  delete json.extensionProvenance;
  for (const alias of Object.keys(ADDITIONS)) {
    files.delete(`icons/svg/${alias}.svg.txt`);
    files.delete(`icons/drawings/${alias}.generated.ts`);
    for (const field of ["icons", "iconoir", "drawings"]) delete json[field][alias];
  }
  files.set("icons/icons.json", `${JSON.stringify(json, null, 2)}\n`);
  return files;
}

/** Reads, listing, writes and deletions all use this closed snapshot; missing files never fall back to live data. */
function virtual(files: Map<string, string>) {
  const reads: string[] = [];
  const io: IconsIo = {
    readText: (path) => {
      reads.push(path);
      const text = files.get(path);
      if (text === undefined) throw new Error(`Missing fixture file: ${path}`);
      return text;
    },
    sha256: (path) => sha256(io.readText(path)),
    list: (dir) => [...files.keys()].filter((path) => dirname(path) === dir).map((path) => path.slice(dir.length + 1)),
    writeText: (path, text) => {
      files.set(path, text);
    },
  };
  const run = (args: string[] = []) => {
    const lines: string[] = [];
    return { code: runIcons(args, io, (line) => lines.push(line)), lines };
  };
  return { io, files, reads, run };
}

function registered() {
  const fixture = virtual(baseFiles());
  const { files, io } = fixture;
  for (const [name, text] of Object.entries(ADDITIONS)) files.set(`icons/svg/${name}.svg.txt`, text);
  const inventory = JSON.parse(files.get("inventory.json") as string);
  files.set("approved-extensions.json", APPROVED_TEXT);
  inventory.Icon.extensions = [{ path: "approved-extensions.json", sha256: io.sha256("approved-extensions.json") }];
  files.set("inventory.json", JSON.stringify(inventory));
  return { ...fixture, inventory };
}

/** A changed record whose hash is reported as the pin, to reach the checks a reviewed pin bump still meets. */
function forged(record: unknown) {
  const fixture = registered();
  fixture.files.set("approved-extensions.json", JSON.stringify(record));
  const sha256 = fixture.io.sha256;
  fixture.io.sha256 = (file) => (file === "approved-extensions.json" ? APPROVED_EXTENSION_SHA256 : sha256(file));
  return fixture;
}

function editRecord(path: string, value: unknown): unknown {
  const record = structuredClone(REGISTRATION);
  const keys = path.split(".");
  let parent = record as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  const key = keys.at(-1) as string;
  if (value === undefined) delete parent[key];
  else parent[key] = value;
  return record;
}

test("icon_absent_extension_preserves_every_output_byte", () => {
  const fixture = virtual(baseFiles());
  const json = fixture.io.readText("icons/icons.json");
  const modules = [...fixture.files]
    .filter(([path]) => path.startsWith("icons/drawings/"))
    .sort(([a], [b]) => a.localeCompare(b));
  expect(sha256(json)).toBe(LEGACY_JSON_SHA256);
  expect(sha256(JSON.stringify(modules))).toBe(LEGACY_MODULES_SHA256);
  expect(Object.keys(JSON.parse(json).icons)).toHaveLength(36);
  expect(JSON.parse(json)).not.toHaveProperty("extensionProvenance");
  expect(JSON.parse(fixture.io.readText("inventory.json")).Icon).not.toHaveProperty("extensions");
  expect(fixture.io.list("icons/svg")).toHaveLength(36);
  expect(modules).toHaveLength(36);
  const writes: string[] = [];
  fixture.io.writeText = (path) => writes.push(path);
  expect(fixture.run()).toEqual({ code: 0, lines: [] });
  expect(fixture.run(["--check"])).toEqual({ code: 0, lines: [] });
  expect(writes).toEqual([]);
});

test("icon_approved_extension_generates_only_the_41_registered_icons", () => {
  const fixture = registered();
  expect(fixture.run()).toEqual({ code: 0, lines: [] });
  const json = JSON.parse(fixture.files.get("icons/icons.json") as string);
  const baseText = baseFiles().get("icons/icons.json") as string;
  expect(sha256(baseText)).toBe(LEGACY_JSON_SHA256);
  const base = JSON.parse(baseText);
  expect(Object.keys(json.icons)).toHaveLength(41);
  expect(json.icons).toEqual({
    ...base.icons,
    devices: "f6e8345b720d99dbdd418f402f50b078e195fce7568f1c670c72086b5755278a",
    apps: "bf364d462e388de5e077cd31107f33f7f52070a96e846a98779252fd79e6b5cd",
    "bulb-off": REGISTRATION.icons["bulb-off"].sourceSha256,
    "bulb-on": REGISTRATION.icons["bulb-on"].sourceSha256,
    tv: REGISTRATION.icons.tv.sourceSha256,
  });
  expect(json.sheetVersion).toBe("1792621080-00d4");
  expect(json.iconoir).toEqual({
    ...base.iconoir,
    devices: "computer",
    apps: "view-grid",
    "bulb-off": "light-bulb",
    "bulb-on": "light-bulb-on",
    tv: "modern-tv",
  });
  expect(json.drawings.devices).toEqual(REGISTRATION.icons.devices.drawings.map(([, attributes]) => attributes));
  expect(json.drawings.apps).toEqual(REGISTRATION.icons.apps.drawings.map(([, attributes]) => attributes));
  expect(json.extensionProvenance).toEqual({
    path: "approved-extensions.json",
    sha256: fixture.io.sha256("approved-extensions.json"),
    designApproval: REGISTRATION.designApproval,
    registeredOn: "2026-10-21",
    iconoirCommit: "d7dfa4d0341df0670bfed9fc24221c9d7ef2112e",
  });
  for (const [name, drawings] of Object.entries(base.drawings)) expect(json.drawings[name]).toEqual(drawings);
  for (const alias of ["devices", "apps"]) {
    const module = fixture.files.get(`icons/drawings/${alias}.generated.ts`);
    expect(module).toContain("Object.freeze([");
    expect(module).toContain('strokeWidth: "1.5"');
  }
  expect(fixture.run(["--check"])).toEqual({ code: 0, lines: [] });
});

test.each([
  null,
  [],
  {},
  [{ path: "approved-extensions.json" }],
  [{ path: "../outside.json", sha256: "a".repeat(64) }],
  [{ path: "https://example.com/icons.json", sha256: "a".repeat(64) }],
  [{ path: "approved-extensions.json", sha256: "a".repeat(64), extra: true }],
  [{ path: "approved-extensions.json", sha256: "invalid" }],
])("icon_malformed_extension_pointer_fails_closed: %j", (pointer) => {
  const fixture = registered();
  fixture.inventory.Icon.extensions = pointer;
  fixture.files.set("inventory.json", JSON.stringify(fixture.inventory));
  expect(code(fixture.run())).toEqual(["icons.registration"]);
  expect(fixture.reads).not.toContain("../outside.json");
  expect(fixture.reads).not.toContain("https://example.com/icons.json");
});

test("icon_duplicate_extension_pointer_is_refused", () => {
  const fixture = registered();
  fixture.inventory.Icon.extensions.push(fixture.inventory.Icon.extensions[0]);
  fixture.files.set("inventory.json", JSON.stringify(fixture.inventory));
  expect(code(fixture.run())).toEqual(["icons.registration"]);
});

test("icon_duplicate_inventory_key_is_refused_before_it_can_hide_a_pointer", () => {
  const fixture = registered();
  // JSON.parse keeps the last "Icon", so a reader of the file sees the first one and the build the second.
  const text = JSON.stringify(fixture.inventory);
  fixture.files.set("inventory.json", text.replace(/^\{/, '{"Icon":{},'));
  expect(code(fixture.run())).toEqual(["icons.registration"]);
});

test.each(["missing", "hash", "json"])("icon_present_but_invalid_record_fails_closed: %s", (fault) => {
  const fixture = registered();
  if (fault === "missing") fixture.files.delete("approved-extensions.json");
  if (fault === "hash")
    fixture.files.set("approved-extensions.json", `${fixture.files.get("approved-extensions.json")} `);
  if (fault === "json") {
    fixture.files.set("approved-extensions.json", "{");
    fixture.inventory.Icon.extensions[0].sha256 = fixture.io.sha256("approved-extensions.json");
    fixture.files.set("inventory.json", JSON.stringify(fixture.inventory));
  }
  expect(code(fixture.run())).toEqual(["icons.registration"]);
});

test.each(["devices", "apps"])("icon_extension_source_bytes_are_immutable: %s", (alias) => {
  for (const change of ["\n", "<script>alert(1)</script>", ' onload="alert(1)"']) {
    const fixture = registered();
    const path = `icons/svg/${alias}.svg.txt`;
    fixture.files.set(path, (ADDITIONS[alias] as string).replace("<path ", `<path ${change}`));
    expect(code(fixture.run())).toEqual(["icons.source_mismatch"]);
  }
});

test("icon_extension_rejects_extra_or_missing_sources_and_alias_collision", () => {
  const extra = registered();
  extra.files.set("icons/svg/third.svg.txt", ADDITIONS.apps as string);
  expect(code(extra.run())).toEqual(["icons.list_mismatch"]);
  const missing = registered();
  missing.files.delete("icons/svg/apps.svg.txt");
  expect(code(missing.run())).toEqual(["icons.list_mismatch"]);
  const collision = forged(editRecord("icons.settings", REGISTRATION.icons.devices));
  collision.files.set("icons/svg/settings.svg.txt", ADDITIONS.devices as string);
  expect(code(collision.run())).toEqual(["icons.list_mismatch"]);
});

test("icon_extension_bytes_match_the_reviewed_pin", () => {
  expect(sha256(APPROVED_TEXT)).toBe(APPROVED_EXTENSION_SHA256);
  const pointer = JSON.parse(readFileSync(join(UI, "inventory.json"), "utf8")).Icon.extensions;
  expect(pointer).toEqual([{ path: "approved-extensions.json", sha256: APPROVED_EXTENSION_SHA256 }]);
});

test.each([0, Math.floor(APPROVED_TEXT.length / 2), APPROVED_TEXT.length - 1])(
  "icon_one_byte_change_to_the_approved_record_fails_closed: offset %i",
  (offset) => {
    const fixture = registered();
    const flipped = APPROVED_TEXT[offset] === " " ? "\t" : " ";
    const changed = `${APPROVED_TEXT.slice(0, offset)}${flipped}${APPROVED_TEXT.slice(offset + 1)}`;
    fixture.files.set("approved-extensions.json", changed);
    fixture.inventory.Icon.extensions[0].sha256 = sha256(changed);
    fixture.files.set("inventory.json", JSON.stringify(fixture.inventory));
    const result = fixture.run();
    expect(code(result)).toEqual(["icons.registration"]);
    expect(result.lines[0]).toContain("shared/ui/approved-extensions.json");
    expect(result.lines[0]).toContain(sha256(changed));
    expect(result.lines[0]).toContain(APPROVED_EXTENSION_SHA256);
  },
);

test.each([
  ["icons.apps.drawings.0.1.onload", "alert(1)", "icons.parse"],
  ["icons.apps.drawings.0.0", "script", "icons.parse"],
  ["icons.devices.sourceSha256", "changed", "icons.registration"],
  ["icons.devices.iconoirName", undefined, "icons.registration"],
  ["icons", undefined, "icons.registration"],
  ["icons.devices.drawings.0.1.d", "M0 0", "icons.drawing_mismatch"],
])("icon_pinned_record_shape_is_still_checked: %s", (path, value, expected) => {
  expect(code(forged(editRecord(path, value)).run())).toEqual([expected]);
});

test.each(["devices", "apps"])("icon_registered_source_still_passes_the_existing_svg_parser: %s", (alias) => {
  for (const change of ['onload="x" ', 'style="fill:red" ', 'd="M0 0" ']) {
    const fixture = registered();
    const path = `icons/svg/${alias}.svg.txt`;
    const originalHash = fixture.io.sha256(path);
    const sha256 = fixture.io.sha256;
    fixture.io.sha256 = (file) => (file === path ? originalHash : sha256(file));
    const original = ADDITIONS[alias] as string;
    fixture.files.set(
      path,
      change.startsWith("d=")
        ? original.replace(/d="[^"]*"/, change.trim())
        : original.replace("<path ", `<path ${change}`),
    );
    expect(code(fixture.run())).toEqual(["icons.drawing_mismatch"]);
  }
});

test("icon_extension_pins_the_actual_base_not_only_its_source_record", () => {
  const fixture = registered();
  const path = "sheet/components/Icon/README.md";
  fixture.files.set(path, `${fixture.io.readText(path)}\n`);
  const source = JSON.parse(fixture.io.readText("sheet/source.json"));
  source.files.find((file: { path: string }) => file.path === path).sha256 = fixture.io.sha256(path);
  fixture.files.set("sheet/source.json", JSON.stringify(source));
  expect(code(fixture.run())).toEqual(["icons.source_mismatch"]);
});
