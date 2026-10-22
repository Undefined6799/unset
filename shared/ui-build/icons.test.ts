// The icon build (P1.24i; architecture record 2026-10-06-p116-retention-usage-and-p124-icon-source.md, follow-up
// 20:10Z): the committed Iconoir files equal the sheet's ICONS data, the sheet's bundle is parsed and never run, and
// nothing outside the element and attribute allowlist gets through.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { ICONOIR_VERSION, type IconsIo, parseSvg, runIcons, sheetDrawings } from "./icons.ts";

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
  expect(Object.keys(json.icons)).toHaveLength(38);
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

// Independent P2.24f fixture inputs: the approved record and exact official Iconoir 7.12.1 source bytes.
const REGISTRATION = {
  schemaVersion: 1,
  baseSheet: {
    version: "1792621080-00d4",
    iconReadmeSha256: "191cecaaee60c6557b2c479874ca87f1f2b6515919397ee123f3bd9d31ddc2b4",
    bundleSha256: "bbd51a646aa5252053779db83c2776b2c6a5d4388bde30b31216ff6818fcbcab",
  },
  designApproval: {
    by: "Alex",
    date: "2026-10-18",
    record: "docs/human/decisions/0027-pds-frontend-distribution.md",
    scope:
      "Existing approved PDS screens and named components; API entries below implement their recorded requirements.",
  },
  registeredOn: "2026-10-21",
  components: {
    Navigation: {
      figmaUrls: [
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=49-1912",
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=49-1978",
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=75-3395",
      ],
      requirements: ["docs/ai/plans/2026-10-18-pds-ui.md#task-3--make-shared-ui-usable-by-the-pds"],
      api: [
        'itemsPlacement?: "end" | "start" = "end"',
        "renderLink?: NavigationLinkRenderer",
        "navigationKey?: string | number",
      ],
      behavior: [
        "Vertical start stack with existing 16px gaps",
        "Labels visible on hover and keyboard focus",
        "Native auto popover; close after caller-confirmed committed navigation",
      ],
    },
    Header: {
      figmaUrls: ["https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=32-2086"],
      requirements: ["docs/ai/plans/2026-10-18-pds-ui-design.md#ownership-and-dependency-boundaries"],
      api: [
        'HeaderProps.homeLabel?: string = "unset.sh home"',
        "BrandHeader and BrandHeaderProps, extracted existing brandOnly composition",
      ],
      behavior: [
        "64px desktop and 56px phone",
        "Translated brand accessible name",
        "Pure ./brand-header package entry imports no app island runtime",
      ],
    },
    Button: {
      figmaUrls: [
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=17-456",
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=49-1912",
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=49-1978",
      ],
      requirements: ["docs/ai/plans/2026-10-18-pds-ui.md#task-3--make-shared-ui-usable-by-the-pds"],
      api: [
        'variant?: "solid" | "standalone" = "solid"',
        "title?: string",
        "aria-label?: string",
        'aria-busy?: boolean | "true" | "false"',
        "button branch: onClick?: MouseEventHandler<HTMLButtonElement>",
        "button branch: ref?: Ref<HTMLButtonElement>",
      ],
      behavior: [
        "Standalone Link appearance with native button semantics",
        "Existing disabled/current/pending behavior remains caller-owned",
        "SafeHref anchor branch and refused/disabled-link fallback remain intact",
      ],
    },
  },
  iconoir: {
    version: "7.12.1",
    commit: "d7dfa4d0341df0670bfed9fc24221c9d7ef2112e",
  },
  icons: {
    devices: {
      iconoirName: "computer",
      figmaUrl: "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=62-1906",
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/computer.svg",
      sourceSha256: "f6e8345b720d99dbdd418f402f50b078e195fce7568f1c670c72086b5755278a",
      drawings: [
        [
          "path",
          {
            d: "M2 21L17 21",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        [
          "path",
          {
            d: "M21 21L22 21",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        [
          "path",
          {
            d: "M2 16.4V3.6C2 3.26863 2.26863 3 2.6 3H21.4C21.7314 3 22 3.26863 22 3.6V16.4C22 16.7314 21.7314 17 21.4 17H2.6C2.26863 17 2 16.7314 2 16.4Z",
            stroke: "currentColor",
            strokeWidth: "1.5",
          },
        ],
      ],
    },
    apps: {
      iconoirName: "view-grid",
      figmaUrl: "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=62-1911",
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/view-grid.svg",
      sourceSha256: "bf364d462e388de5e077cd31107f33f7f52070a96e846a98779252fd79e6b5cd",
      drawings: [
        [
          "path",
          {
            d: "M14 20.4V14.6C14 14.2686 14.2686 14 14.6 14H20.4C20.7314 14 21 14.2686 21 14.6V20.4C21 20.7314 20.7314 21 20.4 21H14.6C14.2686 21 14 20.7314 14 20.4Z",
            stroke: "currentColor",
            strokeWidth: "1.5",
          },
        ],
        [
          "path",
          {
            d: "M3 20.4V14.6C3 14.2686 3.26863 14 3.6 14H9.4C9.73137 14 10 14.2686 10 14.6V20.4C10 20.7314 9.73137 21 9.4 21H3.6C3.26863 21 3 20.7314 3 20.4Z",
            stroke: "currentColor",
            strokeWidth: "1.5",
          },
        ],
        [
          "path",
          {
            d: "M14 9.4V3.6C14 3.26863 14.2686 3 14.6 3H20.4C20.7314 3 21 3.26863 21 3.6V9.4C21 9.73137 20.7314 10 20.4 10H14.6C14.2686 10 14 9.73137 14 9.4Z",
            stroke: "currentColor",
            strokeWidth: "1.5",
          },
        ],
        [
          "path",
          {
            d: "M3 9.4V3.6C3 3.26863 3.26863 3 3.6 3H9.4C9.73137 3 10 3.26863 10 3.6V9.4C10 9.73137 9.73137 10 9.4 10H3.6C3.26863 10 3 9.73137 3 9.4Z",
            stroke: "currentColor",
            strokeWidth: "1.5",
          },
        ],
      ],
    },
  },
};
const ADDITIONS: Record<string, string> = {
  devices:
    '<svg width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M2 21L17 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M21 21L22 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>\n<path d="M2 16.4V3.6C2 3.26863 2.26863 3 2.6 3H21.4C21.7314 3 22 3.26863 22 3.6V16.4C22 16.7314 21.7314 17 21.4 17H2.6C2.26863 17 2 16.7314 2 16.4Z" stroke="currentColor" stroke-width="1.5"/>\n</svg>\n',
  apps: '<svg width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M14 20.4V14.6C14 14.2686 14.2686 14 14.6 14H20.4C20.7314 14 21 14.2686 21 14.6V20.4C21 20.7314 20.7314 21 20.4 21H14.6C14.2686 21 14 20.7314 14 20.4Z" stroke="currentColor" stroke-width="1.5"/>\n<path d="M3 20.4V14.6C3 14.2686 3.26863 14 3.6 14H9.4C9.73137 14 10 14.2686 10 14.6V20.4C10 20.7314 9.73137 21 9.4 21H3.6C3.26863 21 3 20.7314 3 20.4Z" stroke="currentColor" stroke-width="1.5"/>\n<path d="M14 9.4V3.6C14 3.26863 14.2686 3 14.6 3H20.4C20.7314 3 21 3.26863 21 3.6V9.4C21 9.73137 20.7314 10 20.4 10H14.6C14.2686 10 14 9.73137 14 9.4Z" stroke="currentColor" stroke-width="1.5"/>\n<path d="M3 9.4V3.6C3 3.26863 3.26863 3 3.6 3H9.4C9.73137 3 10 3.26863 10 3.6V9.4C10 9.73137 9.73137 10 9.4 10H3.6C3.26863 10 3 9.73137 3 9.4Z" stroke="currentColor" stroke-width="1.5"/>\n</svg>\n',
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
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
  for (const alias of ["devices", "apps"]) {
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
  const pin = (record: unknown = REGISTRATION) => {
    files.set("approved-extensions.json", JSON.stringify(record));
    inventory.Icon.extensions = [{ path: "approved-extensions.json", sha256: io.sha256("approved-extensions.json") }];
    files.set("inventory.json", JSON.stringify(inventory));
  };
  pin();
  return { ...fixture, inventory, pin };
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

test("icon_approved_extension_generates_only_the_38_registered_icons", () => {
  const fixture = registered();
  expect(fixture.run()).toEqual({ code: 0, lines: [] });
  const json = JSON.parse(fixture.files.get("icons/icons.json") as string);
  const baseText = baseFiles().get("icons/icons.json") as string;
  expect(sha256(baseText)).toBe(LEGACY_JSON_SHA256);
  const base = JSON.parse(baseText);
  expect(Object.keys(json.icons)).toHaveLength(38);
  expect(json.icons).toEqual({
    ...base.icons,
    devices: "f6e8345b720d99dbdd418f402f50b078e195fce7568f1c670c72086b5755278a",
    apps: "bf364d462e388de5e077cd31107f33f7f52070a96e846a98779252fd79e6b5cd",
  });
  expect(json.sheetVersion).toBe("1792621080-00d4");
  expect(json.iconoir).toEqual({ ...base.iconoir, devices: "computer", apps: "view-grid" });
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

const PROOF_FIELDS = [
  "schemaVersion",
  "baseSheet.version",
  "baseSheet.iconReadmeSha256",
  "baseSheet.bundleSha256",
  "designApproval.by",
  "designApproval.date",
  "designApproval.record",
  "designApproval.scope",
  "registeredOn",
  "components.Navigation.figmaUrls",
  "components.Navigation.requirements",
  "components.Navigation.api",
  "components.Navigation.behavior",
  "components.Header.figmaUrls",
  "components.Header.requirements",
  "components.Header.api",
  "components.Header.behavior",
  "components.Button.figmaUrls",
  "components.Button.requirements",
  "components.Button.api",
  "components.Button.behavior",
  "iconoir.version",
  "iconoir.commit",
  ...["devices", "apps"].flatMap((name) =>
    ["iconoirName", "figmaUrl", "sourceUrl", "sourceSha256", "drawings"].map((field) => `icons.${name}.${field}`),
  ),
];
test.each(PROOF_FIELDS)("icon_missing_or_tampered_registration_proof_fails: %s", (path) => {
  for (const value of [undefined, "changed"]) {
    const fixture = registered();
    fixture.pin(editRecord(path, value));
    expect(code(fixture.run()), `${path}: ${String(value)}`).toEqual(["icons.registration"]);
  }
});

test.each([
  ["extra", true],
  ["components.Input", {}],
  ["icons.third", REGISTRATION.icons.apps],
  ["icons.devices.extra", true],
  ["icons.devices.iconoirName", "view-grid"],
  ["icons.apps.drawings.0.1.onload", "alert(1)"],
  ["icons.devices.drawings.0.1.d", "M0 0"],
])("icon_unregistered_or_unsafe_record_is_refused: %s", (path, value) => {
  const fixture = registered();
  fixture.pin(editRecord(path as string, value));
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
  const collision = registered();
  const record = structuredClone(REGISTRATION) as unknown as { icons: Record<string, unknown> };
  record.icons.settings = record.icons.devices;
  delete record.icons.devices;
  collision.pin(record);
  expect(code(collision.run())).toEqual(["icons.registration"]);
});

test("icon_component_api_prose_can_record_reviewed_packaging_without_changing_proof", () => {
  const fixture = registered();
  const record = structuredClone(REGISTRATION);
  record.components.Header.api.push("Pure presentation package entry exposes the registered components");
  record.components.Header.behavior.push("Package entry reaches only presentation code");
  fixture.pin(record);
  expect(fixture.run()).toEqual({ code: 0, lines: [] });
});

test("icon_registration_key_order_has_no_effect_on_proof", () => {
  const fixture = registered();
  fixture.pin(Object.fromEntries(Object.entries(REGISTRATION).reverse()));
  expect(fixture.run()).toEqual({ code: 0, lines: [] });
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

test.each(["devices", "apps"])("icon_duplicate_json_alias_is_refused_before_keys_can_be_overwritten: %s", (alias) => {
  const fixture = registered();
  const text = fixture.files.get("approved-extensions.json") as string;
  fixture.files.set("approved-extensions.json", text.replace(`"${alias}":`, `"${alias}":{},"${alias}":`));
  fixture.inventory.Icon.extensions[0].sha256 = fixture.io.sha256("approved-extensions.json");
  fixture.files.set("inventory.json", JSON.stringify(fixture.inventory));
  expect(code(fixture.run())).toEqual(["icons.registration"]);
});

test.each([[], [""], [" "], [17], [null]].map((value) => ({ value })))(
  "icon_empty_or_nontext_component_prose_is_refused: %j",
  ({ value }) => {
    const fixture = registered();
    fixture.pin(editRecord("components.Header.api", value));
    expect(code(fixture.run())).toEqual(["icons.registration"]);
  },
);
