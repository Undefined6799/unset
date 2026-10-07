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

/** Checks the copied files against the sheet, then returns icons.json's text. */
export function buildIcons(io: IconsIo): string {
  const sheetVersion = checkSource(io);
  const list = sheetList(io.readText(README));
  const drawings = sheetDrawings(io.readText(BUNDLE));
  const files = io.list(SVG_DIR).sort();
  const names = [...list.keys()].sort();
  const expected = names.map((n) => `${n}.svg.txt`);
  if (
    JSON.stringify(files) !== JSON.stringify(expected) ||
    JSON.stringify(Object.keys(drawings).sort()) !== JSON.stringify(names)
  )
    throw new IconsError(
      "icons.list_mismatch",
      `${SVG_DIR}/ and the sheet's ICONS must hold exactly the README's list`,
    );
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
  const out = { iconoirVersion: ICONOIR_VERSION, sheetVersion, iconoir, icons, drawings: drawn };
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
