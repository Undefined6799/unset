// The icon build (P1.24i; plan §7, decision 33). icons/svg/<name>.svg.txt are Iconoir's own files, copied byte for byte
// from its repository at tag v7.12.1 (icons/regular/<iconoir-name>.svg); the .txt suffix keeps lint tools off copied
// third-party data, as for the sheet copy. This run proves they are the sheet's drawings, then writes icons/icons.json:
// the allowlist, each file's sha256, and the drawings the Icon component renders (each a list of <path> attributes). It
// also writes each drawing as its own module, icons/drawings/<name>.generated.ts, so an island imports only the icons
// it draws (P1.24b; architecture record 2026-10-07-p124b-island-icons.md). It imports no Node built-in;
// scripts/ui/icons.ts binds node:fs to it.
//
// The sheet holds the list in components/Icon/README.md (a table of our name and Iconoir's name) and the drawings as
// the ICONS object in components/bundle.js, copied to sheet/bundle.js.txt (both recorded in source.json).

export const ICONOIR_VERSION = "7.12.1";
export const ICON_COUNT = 36;

export type IconsIo = {
  readText(path: string): string;
  sha256(path: string): string;
  list(dir: string): string[];
  writeText(path: string, text: string): void;
};
export type IconsCode =
  | "icons.registration"
  | "icons.parse"
  | "icons.source_mismatch"
  | "icons.list_mismatch"
  | "icons.drawing_mismatch"
  | "icons.stale";
export class IconsError extends Error {
  readonly code: IconsCode;
  constructor(code: IconsCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

/** One drawn element: its tag and its attributes, in the sheet's camelCase names. */
export type IconElement = readonly [tag: "path", attributes: Readonly<Record<string, string>>];

const README = "sheet/components/Icon/README.md";
const BUNDLE = "sheet/bundle.js.txt";
const SVG_DIR = "icons/svg";
const OUT = "icons/icons.json";
const DRAWINGS_DIR = "icons/drawings";
const SUFFIX = ".generated.ts";
const ROW = /^\| `([a-z]+)` \| `([a-z-]+)` \|/gm;
/** Iconoir's root element, attribute for attribute (order varies between its files). */
const ROOT: Readonly<Record<string, string>> = {
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  "stroke-width": "1.5",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
};
const ATTRIBUTE: Readonly<Record<string, string>> = {
  d: "d",
  fill: "fill",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
};

/** Our name → Iconoir's name, in the README's order. */
export function sheetList(readme: string): Map<string, string> {
  const list = new Map([...readme.matchAll(ROW)].map((m) => [m[1] as string, m[2] as string]));
  if (list.size !== ICON_COUNT) throw new IconsError("icons.parse", `${README} lists ${list.size} icons`);
  return list;
}

const ICONS_START = "ICONS = ";

/** The ICONS object literal in the sheet's bundle; it is plain JSON, and nothing else is accepted (no fallback). */
export function sheetDrawings(bundle: string): Record<string, IconElement[]> {
  // The slice runs from the one `ICONS = ` to the first `;` that ends a line after it; anything else fails.
  const start = bundle.indexOf(ICONS_START);
  const end = bundle.indexOf(";\n", start);
  if (start === -1 || bundle.indexOf(ICONS_START, start + 1) !== -1 || end === -1)
    throw new IconsError("icons.parse", `${BUNDLE} has no single ICONS = …; statement`);
  const text = bundle.slice(start + ICONS_START.length, end);
  let value: unknown;
  try {
    // JSON's grammar has only literals, so no computed key, call, spread or template can parse, and nothing runs.
    value = JSON.parse(text);
  } catch (error) {
    throw new IconsError("icons.parse", `${BUNDLE} ICONS is not a plain literal: ${String(error)}`);
  }
  return checkDrawings(value);
}

const CAMEL = new Set(["d", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin"]);

/** Every drawing is a list of [ "path", { allowlisted attribute: string } ]; anything else fails. */
function checkDrawings(value: unknown): Record<string, IconElement[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new IconsError("icons.parse", "ICONS is not an object");
  for (const [name, elements] of Object.entries(value)) {
    const ok =
      Array.isArray(elements) &&
      elements.every(
        (e) =>
          Array.isArray(e) &&
          e.length === 2 &&
          e[0] === "path" &&
          typeof e[1] === "object" &&
          e[1] !== null &&
          Object.entries(e[1]).every(([k, v]) => CAMEL.has(k) && typeof v === "string"),
      );
    if (!ok) throw new IconsError("icons.parse", `ICONS.${name} holds an element or attribute outside the allowlist`);
  }
  return value as Record<string, IconElement[]>;
}

const attributes = (text: string): Record<string, string> =>
  Object.fromEntries([...text.matchAll(/([A-Za-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** An Iconoir file as elements; anything but its root and self-closing <path> elements is refused. */
export function parseSvg(name: string, svg: string): IconElement[] {
  const match = /^<svg ([^>]*)>\n((?:<path [^>]*\/>\n)*)<\/svg>\n$/.exec(svg);
  if (match === null) throw new IconsError("icons.drawing_mismatch", `${name}.svg is not a plain Iconoir file`);
  const root = attributes(match[1] as string);
  if (JSON.stringify(sortKeys(root)) !== JSON.stringify(sortKeys(ROOT)))
    throw new IconsError("icons.drawing_mismatch", `${name}.svg has an unexpected root element`);
  return [...(match[2] as string).matchAll(/<path ([^>]*)\/>/g)].map((m) => {
    const entries = Object.entries(attributes(m[1] as string)).map(([key, value]) => {
      const camel = ATTRIBUTE[key];
      if (camel === undefined) throw new IconsError("icons.drawing_mismatch", `${name}.svg has attribute ${key}`);
      return [camel, value];
    });
    return ["path", Object.fromEntries(entries)];
  });
}

const sortKeys = (o: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(o).sort());
const same = (a: readonly IconElement[], b: readonly IconElement[]): boolean =>
  JSON.stringify(a.map(([t, x]) => [t, sortKeys(x)])) === JSON.stringify(b.map(([t, x]) => [t, sortKeys(x)]));

type Source = { sheetVersion: string; files: { path: string; sha256: string }[] };

/** The README and bundle are the bytes source.json recorded from the sheet; returns the sheet version. */
function checkSource(io: IconsIo): string {
  const source = JSON.parse(io.readText("sheet/source.json")) as Source;
  for (const path of [README, BUNDLE]) {
    const recorded = source.files.find((f) => f.path === path)?.sha256;
    const actual = io.sha256(path);
    if (recorded !== actual)
      throw new IconsError("icons.source_mismatch", `${path} is ${actual}, source.json says ${recorded}`);
  }
  return source.sheetVersion;
}

const EXTENSION = "approved-extensions.json";
// P2.24f: the single approved ADR 0027 / Task 3 registration. This is a closed contract, not a registry.
// Immutable Iconoir 7.12.1 sources and exact Figma nodes are recorded here alongside their approval evidence.
const APPROVED_EXTENSION = {
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
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=135-806",
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=135-858",
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=135-935",
      ],
      requirements: ["docs/ai/plans/2026-10-18-pds-ui.md#task-3--make-shared-ui-usable-by-the-pds"],
    },
    Header: {
      figmaUrls: ["https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=32-2086"],
      requirements: ["docs/ai/plans/2026-10-18-pds-ui-design.md#ownership-and-dependency-boundaries"],
    },
    Button: {
      figmaUrls: [
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=17-456",
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=49-1912",
        "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=49-1978",
      ],
      requirements: ["docs/ai/plans/2026-10-18-pds-ui.md#task-3--make-shared-ui-usable-by-the-pds"],
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
    "bulb-off": {
      iconoirName: "light-bulb",
      figmaUrl: "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=151-939",
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/light-bulb.svg",
      sourceSha256: "c2a5d2a7de5a05a81b169f5701f60fef924d05067c4fcd41b18aa78f718621f8",
      drawings: [
        ["path", { d: "M9 18H15", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M10 21H14", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          {
            d: "M9.00082 15C9.00098 13 8.50098 12.5 7.50082 11.5C6.50067 10.5 6.02422 9.48689 6.00082 8C5.95284 4.95029 8.00067 3 12.0008 3C16.001 3 18.0488 4.95029 18.0008 8C17.9774 9.48689 17.5007 10.5 16.5008 11.5C15.501 12.5 15.001 13 15.0008 15",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
      ],
    },
    "bulb-on": {
      iconoirName: "light-bulb-on",
      figmaUrl: "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=151-939",
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/light-bulb-on.svg",
      sourceSha256: "d1f1ec747dffe741096cb553e6ee82d1df24573547a72201f9c1ffe84832743f",
      drawings: [
        ["path", { d: "M21 2L20 3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M3 2L4 3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M21 16L20 15", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M3 16L4 15", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M9 18H15", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M10 21H14", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          {
            d: "M11.9998 3C7.9997 3 5.95186 4.95029 5.99985 8C6.02324 9.48689 6.4997 10.5 7.49985 11.5C8.5 12.5 9 13 8.99985 15H14.9998C15 13.0001 15.5 12.5 16.4997 11.5001L16.4998 11.5C17.4997 10.5 17.9765 9.48689 17.9998 8C18.0478 4.95029 16 3 11.9998 3Z",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
      ],
    },
    tv: {
      iconoirName: "modern-tv",
      figmaUrl: "https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=151-939",
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/modern-tv.svg",
      sourceSha256: "0c71cfd7f5c25858f2876a85de1bef57f595ad69fa57011f40a87ee86dee6ca5",
      drawings: [
        ["path", { d: "M7 21L17 21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
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
    // Alex 2026-10-27: the README editor's block menu and formatting bar (16 icons).
    text: {
      iconoirName: "text",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/text.svg",
      sourceSha256: "e334a56aefdd7379a6f4ea07e9e48f2efdbd69e57bcc4cd19211b8e585b4c0d3",
      drawings: [
        ["path", { d: "M19 7V5L5 5V7", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          {
            d: "M12 5L12 19M12 19H10M12 19H14",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
      ],
    },
    display: {
      iconoirName: "text-size",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/text-size.svg",
      sourceSha256: "4c727de5535fe870bbd0b55aacc568249a387f943c9be58bc01b8774e7d2ce82",
      drawings: [
        ["path", { d: "M3 7L3 5L17 5V7", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          {
            d: "M10 5L10 19M10 19H12M10 19H8",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        ["path", { d: "M13 14L13 12H21V14", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          {
            d: "M17 12V19M17 19H15.5M17 19H18.5",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
      ],
    },
    quote: {
      iconoirName: "quote",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/quote.svg",
      sourceSha256: "2d2f61f1f3c2a647a0af10b8bd5afcb11bf947c322de1d3fcec57789334fd762",
      drawings: [
        [
          "path",
          {
            d: "M10 12H5C4.44772 12 4 11.5523 4 11V7.5C4 6.94772 4.44772 6.5 5 6.5H9C9.55228 6.5 10 6.94772 10 7.5V12ZM10 12C10 14.5 9 16 6 17.5",
            stroke: "currentColor",
            strokeLinecap: "round",
          },
        ],
        [
          "path",
          {
            d: "M20 12H15C14.4477 12 14 11.5523 14 11V7.5C14 6.94772 14.4477 6.5 15 6.5H19C19.5523 6.5 20 6.94772 20 7.5V12ZM20 12C20 14.5 19 16 16 17.5",
            stroke: "currentColor",
            strokeLinecap: "round",
          },
        ],
      ],
    },
    "bullet-list": {
      iconoirName: "list",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/list.svg",
      sourceSha256: "503708f73587ae9feba442c9f041f2b76698be15dcd5a70dce3c92ab46740a8a",
      drawings: [
        ["path", { d: "M8 6L20 6", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          { d: "M4 6.01L4.01 5.99889", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" },
        ],
        [
          "path",
          { d: "M4 12.01L4.01 11.9989", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" },
        ],
        [
          "path",
          { d: "M4 18.01L4.01 17.9989", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" },
        ],
        ["path", { d: "M8 12L20 12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M8 18L20 18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
      ],
    },
    "numbered-list": {
      iconoirName: "numbered-list-left",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/numbered-list-left.svg",
      sourceSha256: "1d787ab3ba821c142245b8ecb49f2730cff88d70385ce32cf53324a245c6d442",
      drawings: [
        ["path", { d: "M9 5L21 5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M5 7L5 3L3.5 4.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          {
            d: "M5.5 14L3.5 14L5.40471 11.0371C5.46692 10.9403 5.50215 10.8268 5.47709 10.7145C5.41935 10.4557 5.216 10 4.5 10C3.50001 10 3.5 10.8889 3.5 10.8889C3.5 10.8889 3.5 10.8889 3.5 10.8889L3.5 11.1111",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        [
          "path",
          {
            d: "M4 19L4.5 19C5.05228 19 5.5 19.4477 5.5 20V20C5.5 20.5523 5.05228 21 4.5 21L3.5 21",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        ["path", { d: "M3.5 17L5.5 17L4 19", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M9 12L21 12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M9 19L21 19", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
      ],
    },
    "check-list": {
      iconoirName: "task-list",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/task-list.svg",
      sourceSha256: "5700f48d763355bf15c7258e05a0daaa9de4308505fb2f967811288ac8234cc6",
      drawings: [
        ["path", { d: "M9 6L20 6", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          {
            d: "M3.80002 5.79999L4.60002 6.59998L6.60001 4.59999",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        [
          "path",
          {
            d: "M3.80002 11.8L4.60002 12.6L6.60001 10.6",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        [
          "path",
          {
            d: "M3.80002 17.8L4.60002 18.6L6.60001 16.6",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        ["path", { d: "M9 12L20 12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M9 18L20 18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
      ],
    },
    "code-block": {
      iconoirName: "code-brackets",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/code-brackets.svg",
      sourceSha256: "8885bba2e2c636f17dc9483e6c6e00edd8f1fa8c688abfd31e6cb876a8dcc212",
      drawings: [
        [
          "path",
          {
            d: "M9.00001 21L8.00001 21C6.89544 21 6.00001 20.1057 6.00001 19.0011C6.00001 17.4501 6.00001 15.3443 6 14C6 13 4.5 12 4.5 12C4.5 12 6.00001 11 6.00001 10C6.00001 8.827 6.00001 6.62207 6.00001 4.99914C6.00001 3.89457 6.89544 3 8.00001 3L9.00001 3",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        [
          "path",
          {
            d: "M15 21L16 21C17.1046 21 18 20.1057 18 19.0011C18 17.4501 18 15.3443 18 14C18 13 19.5 12 19.5 12C19.5 12 18 11 18 10C18 8.827 18 6.62207 18 4.99914C18 3.89457 17.1046 3 16 3L15 3",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
      ],
    },
    bold: {
      iconoirName: "bold",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/bold.svg",
      sourceSha256: "4288dadb50cc126a9117112b71924f0d30ade0fc8e18f22536d6b35c3b75f628",
      drawings: [
        [
          "path",
          {
            d: "M12 11.6667H8M12 11.6667C12 11.6667 15.3333 11.6667 15.3333 8.33333C15.3333 5.00002 12 5 12 5C12 5 12 5 12 5H8.6C8.26863 5 8 5.26863 8 5.6V11.6667M12 11.6667C12 11.6667 16 11.6667 16 15.3333C16 19 12 19 12 19C12 19 12 19 12 19H8.6C8.26863 19 8 18.7314 8 18.4V11.6667",
            stroke: "currentColor",
            strokeWidth: "1.5",
          },
        ],
      ],
    },
    italic: {
      iconoirName: "italic",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/italic.svg",
      sourceSha256: "d06e0f9fd69857ab0b692e61895885271ef37443c1393ec6aba4f86466616a30",
      drawings: [
        [
          "path",
          {
            d: "M11 5L14 5M17 5L14 5M14 5L10 19M10 19L7 19M10 19L13 19",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
      ],
    },
    underline: {
      iconoirName: "underline",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/underline.svg",
      sourceSha256: "9dd20b3d700833db4e27df89ffb6d685244f64af2a529706dab6ba6803d885e0",
      drawings: [
        [
          "path",
          {
            d: "M16 5V11C16 13.2091 14.2091 15 12 15V15C9.79086 15 8 13.2091 8 11V5",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        ["path", { d: "M6 19L18 19", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
      ],
    },
    strike: {
      iconoirName: "strikethrough",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/strikethrough.svg",
      sourceSha256: "21614ebf0359ad62c70d80e9c7f9782113292e5dc08a302dbdeb8bcf0296414b",
      drawings: [
        ["path", { d: "M3 12L21 12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          {
            d: "M16.2857 3L10.068 3C7.82129 3 6 4.82129 6 7.06797C6 8.81895 7.12044 10.3735 8.78157 10.9272L12 12M6 21H13.932C16.1787 21 18 19.1787 18 16.932C18 16.2409 17.8255 15.5804 17.512 15",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
      ],
    },
    "inline-code": {
      iconoirName: "code",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/code.svg",
      sourceSha256: "dfdd2ec8355b62482c7f220c914c93bc610ee235afc61f9a1d02c8b20fe685fa",
      drawings: [
        ["path", { d: "M13.5 6L10 18.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        [
          "path",
          { d: "M6.5 8.5L3 12L6.5 15.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" },
        ],
        [
          "path",
          { d: "M17.5 8.5L21 12L17.5 15.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" },
        ],
      ],
    },
    link: {
      iconoirName: "link",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/link.svg",
      sourceSha256: "84a5b6ae115d7afff785889a88d98a4615951a30f15984fb7b4e1644b8e8faed",
      drawings: [
        [
          "path",
          {
            d: "M14 11.9976C14 9.5059 11.683 7 8.85714 7C8.52241 7 7.41904 7.00001 7.14286 7.00001C4.30254 7.00001 2 9.23752 2 11.9976C2 14.376 3.70973 16.3664 6 16.8714C6.36756 16.9525 6.75006 16.9952 7.14286 16.9952",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
        [
          "path",
          {
            d: "M10 11.9976C10 14.4893 12.317 16.9952 15.1429 16.9952C15.4776 16.9952 16.581 16.9952 16.8571 16.9952C19.6975 16.9952 22 14.7577 22 11.9976C22 9.6192 20.2903 7.62884 18 7.12383C17.6324 7.04278 17.2499 6.99999 16.8571 6.99999",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        ],
      ],
    },
    "align-left": {
      iconoirName: "align-left",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/align-left.svg",
      sourceSha256: "fb5d4bfc94ee5a0428439014401e2d94c800f00109bf1382bc91209caccc2c41",
      drawings: [
        ["path", { d: "M3 10L17 10", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M3 6H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M3 18L17 18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M3 14H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
      ],
    },
    "align-center": {
      iconoirName: "align-center",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/align-center.svg",
      sourceSha256: "01023a0bebd3d03d27a53636bb2556d0d62ae79c6831052043c5744425c7e2c4",
      drawings: [
        ["path", { d: "M3 6H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M3 14H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M6 10L18 10", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M6 18L18 18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
      ],
    },
    "align-right": {
      iconoirName: "align-right",
      approval:
        'Alex 2026-10-27 20:43Z ("Yes thats good"), on the editor mockup icons-mock.png in the README editor thread',
      sourceUrl:
        "https://raw.githubusercontent.com/iconoir-icons/iconoir/d7dfa4d0341df0670bfed9fc24221c9d7ef2112e/icons/regular/align-right.svg",
      sourceSha256: "672d1c8e3adf6b1e288f2b282f8aed1a4009346906133113046a1ca00f9dc8d4",
      drawings: [
        ["path", { d: "M7 10L21 10", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M3 6H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M7 18L21 18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
        ["path", { d: "M3 14H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }],
      ],
    },
  },
} as const;

/** Exact JSON structure and values, independent of object key order; unknown or missing fields fail. */
function sameRegistration(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object") return false;
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  const entries = Object.entries(expected);
  return (
    Object.keys(actual).length === entries.length &&
    entries.every(
      ([key, value]) => Object.hasOwn(actual, key) && sameRegistration((actual as Record<string, unknown>)[key], value),
    )
  );
}

/** Component prose may evolve during review; its schema and all source/evidence identities stay closed. */
function approvedRegistration(record: unknown): boolean {
  const components = (record as { components?: Record<string, { api?: unknown; behavior?: unknown }> } | null)
    ?.components;
  const prose = (value: unknown) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((text) => typeof text === "string" && text.trim().length > 0);
  const expected = Object.fromEntries(
    Object.entries(APPROVED_EXTENSION.components).map(([name, proof]) => {
      const entry = components?.[name];
      return [name, { ...proof, api: entry?.api, behavior: entry?.behavior }];
    }),
  );
  return (
    Object.values(expected).every((entry) => prose(entry.api) && prose(entry.behavior)) &&
    sameRegistration(record, { ...APPROVED_EXTENSION, components: expected })
  );
}

/** Parse JSON without silently losing duplicate keys (including duplicate icon aliases). */
function registrationJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  // JSON.parse already proved the grammar. Canonicalize string/number tokens and remove only outside whitespace;
  // a duplicate key is the only information this round trip can lose in this closed, nonnumeric-keyed schema.
  const compact = text.replace(/"(?:[^"\\]|\\.)*"|\s+|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) =>
    /^\s/.test(token) ? "" : JSON.stringify(JSON.parse(token)),
  );
  if (compact !== JSON.stringify(value)) throw new Error("duplicate registration keys");
  return value;
}

/** Only the fixed, hash-pinned optional Icon pointer may extend the immutable 36-icon sheet. */
function registeredIcons(io: IconsIo, sheetVersion: string) {
  try {
    const inventory = registrationJson(io.readText("inventory.json")) as { Icon?: { extensions?: unknown } } | null;
    const icon = inventory?.Icon;
    if (!icon || typeof icon !== "object" || Array.isArray(icon)) throw new Error("missing Icon inventory");
    if (!Object.hasOwn(icon, "extensions")) return undefined;
    const pointer = icon.extensions as { path?: unknown; sha256?: unknown }[];
    const sha256 = Array.isArray(pointer) ? pointer[0]?.sha256 : undefined;
    if (
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      !sameRegistration(pointer, [{ path: EXTENSION, sha256 }])
    )
      throw new Error("invalid Icon pointer");
    // Never resolve a path supplied by the record, even before its proof has been checked.
    if (io.sha256(EXTENSION) !== sha256) throw new Error("registration hash mismatch");
    const record = registrationJson(io.readText(EXTENSION));
    if (!approvedRegistration(record)) throw new Error("unapproved registration");
    const base = APPROVED_EXTENSION.baseSheet;
    if (
      sheetVersion !== base.version ||
      io.sha256(README) !== base.iconReadmeSha256 ||
      io.sha256(BUNDLE) !== base.bundleSha256
    )
      throw new IconsError("icons.source_mismatch", "registration does not match the immutable base sheet");
    return { record: APPROVED_EXTENSION, sha256 };
  } catch (error) {
    if (error instanceof IconsError) throw error;
    throw new IconsError("icons.registration", `invalid or unreadable ${EXTENSION}: ${String(error)}`);
  }
}

/** Checks the copied files against the sheet and any fixed registration, then returns icons.json's text. */
export function buildIcons(io: IconsIo): string {
  const sheetVersion = checkSource(io);
  const list = sheetList(io.readText(README));
  const drawings = sheetDrawings(io.readText(BUNDLE));
  const sheetNames = [...list.keys()].sort();
  if (JSON.stringify(Object.keys(drawings).sort()) !== JSON.stringify(sheetNames))
    throw new IconsError("icons.list_mismatch", "the sheet's ICONS must hold exactly the README's list");
  const extension = registeredIcons(io, sheetVersion);
  const additions: Readonly<Record<string, (typeof APPROVED_EXTENSION.icons)[keyof typeof APPROVED_EXTENSION.icons]>> =
    extension?.record.icons ?? {};
  for (const [name, registered] of Object.entries(additions)) {
    if (list.has(name) || [...list.values()].includes(registered.iconoirName))
      throw new IconsError("icons.list_mismatch", `${name} collides with the imported sheet`);
    list.set(name, registered.iconoirName);
    drawings[name] = [...registered.drawings];
  }
  const files = io.list(SVG_DIR).sort();
  const expected = [...list.keys()].sort().map((n) => `${n}.svg.txt`);
  if (JSON.stringify(files) !== JSON.stringify(expected))
    throw new IconsError("icons.list_mismatch", `${SVG_DIR}/ must hold exactly the sheet and registered icon list`);
  for (const [name, registered] of Object.entries(additions)) {
    if (io.sha256(`${SVG_DIR}/${name}.svg.txt`) !== registered.sourceSha256)
      throw new IconsError("icons.source_mismatch", `${name}.svg differs from its immutable Iconoir source`);
  }
  const icons: Record<string, string> = {};
  const drawn: Record<string, Readonly<Record<string, string>>[]> = {};
  for (const [name, iconoir] of list) {
    const file = `${SVG_DIR}/${name}.svg.txt`;
    const elements = parseSvg(name, io.readText(file));
    if (!same(elements, drawings[name] ?? []))
      throw new IconsError("icons.drawing_mismatch", `${name}.svg (Iconoir ${iconoir}) differs from the sheet`);
    icons[name] = io.sha256(file);
    drawn[name] = elements.map(([, attributes]) => attributes);
  }
  const iconoir = Object.fromEntries(list);
  const out = {
    iconoirVersion: ICONOIR_VERSION,
    sheetVersion,
    iconoir,
    icons,
    drawings: drawn,
    ...(extension === undefined
      ? {}
      : {
          extensionProvenance: {
            path: EXTENSION,
            sha256: extension.sha256,
            designApproval: extension.record.designApproval,
            registeredOn: extension.record.registeredOn,
            iconoirCommit: extension.record.iconoir.commit,
          },
        }),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

type IconsJson = { iconoirVersion: string; drawings: Record<string, Record<string, string>[]> };

/** One frozen path list per icon, from icons.json's text; each key is the module's path. */
export function drawingModules(json: string): Map<string, string> {
  const { iconoirVersion, drawings } = JSON.parse(json) as IconsJson;
  const header = `// Generated by \`node scripts/ui/icons.ts\` from icons/icons.json (Iconoir ${iconoirVersion}); never edit.\n`;
  return new Map(
    Object.entries(drawings).map(([name, paths]) => {
      const items = paths.map((attributes) => {
        const fields = Object.entries(attributes).map(([key, value]) => `    ${key}: ${JSON.stringify(value)},\n`);
        return `  Object.freeze({\n${fields.join("")}  }),\n`;
      });
      const body = `const drawing: IconPaths = Object.freeze([\n${items.join("")}]);\n\nexport default drawing;\n`;
      const imports = 'import type { IconPaths } from "../../components/Icon/Icon.tsx";\n\n';
      return [`${DRAWINGS_DIR}/${name}${SUFFIX}`, `${header}${imports}${body}`];
    }),
  );
}

const readOrNone = (io: IconsIo, path: string): string | undefined => {
  try {
    return io.readText(path);
  } catch {
    return undefined;
  }
};

/** `icons.ts [--check]`: 0 when icons.json and the drawing modules are (or now are) current; 1 with the error code. */
export function runIcons(args: string[], io: IconsIo, print: (line: string) => void): number {
  try {
    const json = buildIcons(io);
    const outputs = new Map([[OUT, json], ...drawingModules(json)]);
    for (const [path, text] of outputs) {
      if (readOrNone(io, path) === text) continue;
      if (args.includes("--check"))
        throw new IconsError("icons.stale", `${path} differs; run node scripts/ui/icons.ts`);
      io.writeText(path, text);
    }
    // The run never deletes, so a module for an icon the sheet dropped fails until someone removes it.
    const extra = io.list(DRAWINGS_DIR).filter((file) => !outputs.has(`${DRAWINGS_DIR}/${file}`));
    if (extra.length > 0) throw new IconsError("icons.stale", `${DRAWINGS_DIR}/ also holds ${extra.join(", ")}`);
    return 0;
  } catch (error) {
    print(error instanceof IconsError ? error.message : `icons.parse: ${String(error)}`);
    return 1;
  }
}
