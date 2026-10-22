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
