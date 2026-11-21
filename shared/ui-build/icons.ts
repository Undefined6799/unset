// The icon build (P1.24i; plan §7, decision 33). icons/svg/<name>.svg.txt are Iconoir's own files, copied byte for byte
// from its repository at tag v7.12.1 (icons/regular/<iconoir-name>.svg); the .txt suffix keeps lint tools off copied
// third-party data, as for the sheet copy. This run proves they are the sheet's drawings, then writes icons/icons.json:
// the allowlist, each file's sha256, and the drawings the Icon component renders (each a list of <path> attributes).
// The Svelte Icon reads icons.json itself, so no per-icon module is written (P1.20k). It imports no Node built-in;
// scripts/ui/icons.ts binds node:fs to it.
//
// The sheet holds the list in components/Icon/README.md (a table of our name and Iconoir's name) and the drawings as
// the ICONS object in components/bundle.js, copied to sheet/bundle.js.txt (both recorded in source.json).

export const ICONOIR_VERSION = "7.12.1";
const ICON_COUNT = 36;

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
class IconsError extends Error {
  readonly code: IconsCode;
  constructor(code: IconsCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

/** One drawn element: its tag and its attributes, in the sheet's camelCase names. */
export type IconElement = readonly [tag: "path", attributes: Readonly<Record<string, string>>];
/** A drawing as icons.json holds it: each path's attributes. */
type Drawn = Readonly<Record<string, string>>[];
/** The Lucide drawings and icons.json's `lucide` field, both empty when there is no Lucide file. */
type LucideOut = { drawings: Record<string, Drawn>; field: { lucide?: typeof LUCIDE } };

const README = "sheet/components/Icon/README.md";
const BUNDLE = "sheet/bundle.js.txt";
const SVG_DIR = "icons/svg";
const OUT = "icons/icons.json";
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
function sheetList(readme: string): Map<string, string> {
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

/**
 * The icons from a second set, Lucide 1.72.0 (ISC, icons/LICENSE-lucide.txt), each copied byte for byte from
 * https://raw.githubusercontent.com/lucide-icons/lucide/1.72.0/icons/<lucideName>.svg to icons/lucide/<name>.svg.txt.
 * ADR 0087: `grip-vertical`, the six-dot drag handle Crepe 7.23.0 draws. ADR 0097: `heading-1` to `heading-6`, the
 * block menu's numbered headings Crepe draws. Iconoir 7.12.1 has neither. No other file may sit in icons/lucide/ and
 * no Lucide package is installed.
 */
export const LUCIDE = {
  version: "1.72.0",
  icons: {
    grip: { lucideName: "grip-vertical", sha256: "ddf3a20c45869614f7b49dd14c5cbaba026d4155382e30b0ae8418f31c1ce2c5" },
    h1: { lucideName: "heading-1", sha256: "d5920a0a7182751a071374f9c4dad0519afe4ca509da1e893cb09deba52d5c8f" },
    h2: { lucideName: "heading-2", sha256: "a1fc4240bad7d883433927faca643b346e148ef721a571f95043be085555ae05" },
    h3: { lucideName: "heading-3", sha256: "32d24e7734fc9bdba2c64f42c34761781249599364417c14b5cd06fa19c87551" },
    h4: { lucideName: "heading-4", sha256: "33141a2aa843631f9a850cf867aa44c94e6289ba7438870bd661e60aebe03d79" },
    h5: { lucideName: "heading-5", sha256: "f2e3885ab0c15dd3f037c047fa8b7229d316b920849cd77e275b96702c0cd994" },
    h6: { lucideName: "heading-6", sha256: "cbad3fe7096b0431777ae07ff87fd61ac952aaa53f3ce626c6d46dcfc70f757e" },
  },
} as const;
const LUCIDE_DIR = "icons/lucide";
const LUCIDE_ROOT =
  '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n' +
  '  stroke="currentColor"\n  stroke-width="2"\n  stroke-linecap="round"\n  stroke-linejoin="round"\n>\n';
const LUCIDE_CIRCLE = /^ {2}<circle cx="(\d{1,2})" cy="(\d{1,2})" r="([12])" \/>$/;
/** A path with path data only: commands, digits, signs, dots, commas and spaces; no other attribute. */
const LUCIDE_PATH = /^ {2}<path d="([MmLlHhVvCcSsQqTtAaZz\d .,-]{1,512})" \/>$/;

/** One Lucide line as an Iconoir-style path: a circle becomes the two arcs that draw it. */
function lucideLine(line: string): string | null {
  const path = LUCIDE_PATH.exec(line);
  if (path !== null) return path[1] ?? null;
  const circle = LUCIDE_CIRCLE.exec(line);
  if (circle === null) return null;
  const [cx, cy, r] = [Number(circle[1]), Number(circle[2]), Number(circle[3])];
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0`;
}

/**
 * A Lucide file of paths and radius-1 or -2 circles as Iconoir-style paths, with Lucide's colour, caps and joins; its
 * stroke width 2 is left out so the Icon's 1.5 applies. Anything else is refused.
 */
export function parseLucide(name: string, svg: string): IconElement[] {
  const refuse = () => new IconsError("icons.drawing_mismatch", `${name}.svg is not a plain Lucide path file`);
  if (!svg.startsWith(LUCIDE_ROOT) || !svg.endsWith("\n</svg>\n")) throw refuse();
  const lines = svg.slice(LUCIDE_ROOT.length, -"\n</svg>\n".length).split("\n");
  return lines.map((line) => {
    const d = lucideLine(line);
    if (d === null) throw refuse();
    return ["path", { d, stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }];
  });
}

/**
 * The Lucide drawings as icons.json writes them, and its `lucide` field; neither when icons/lucide/ is empty or
 * absent. Any file but a pinned one, and any name an Iconoir icon already has, is refused.
 */
function lucideDrawings(io: IconsIo, iconoir: ReadonlyMap<string, string>): LucideOut {
  const files = listOrNone(io, LUCIDE_DIR);
  if (files.length === 0) return { drawings: {}, field: {} };
  const pinned = Object.keys(LUCIDE.icons).map((n) => `${n}.svg.txt`);
  if (JSON.stringify(files.sort()) !== JSON.stringify(pinned.sort()))
    throw new IconsError("icons.list_mismatch", `${LUCIDE_DIR}/ may hold only ${pinned.join(", ")}`);
  const out: Record<string, Drawn> = {};
  for (const [name, pin] of Object.entries(LUCIDE.icons)) {
    if (iconoir.has(name)) throw new IconsError("icons.list_mismatch", `${name} is both an Iconoir and a Lucide icon`);
    const file = `${LUCIDE_DIR}/${name}.svg.txt`;
    if (io.sha256(file) !== pin.sha256)
      throw new IconsError(
        "icons.source_mismatch",
        `${name}.svg differs from Lucide ${LUCIDE.version} ${pin.lucideName}`,
      );
    out[name] = parseLucide(name, io.readText(file)).map(([, attributes]) => attributes);
  }
  return { drawings: out, field: { lucide: LUCIDE } };
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
// P2.24f: sha256 of the exact bytes of shared/ui/approved-extensions.json that Alex approved (ADR 0027 / Task 3). Any
// byte change to that file, prose and key order included, needs a reviewed bump of this hash in the same PR.
export const APPROVED_EXTENSION_SHA256 = "d49c16d9750faf11bb088e85c69943da5947eb6917c6a51d6718af4f0099a215";

type RegisteredIcon = { iconoirName: string; sourceSha256: string; drawings: IconElement[] };
type Registration = {
  baseSheet: { version: string; iconReadmeSha256: string; bundleSha256: string };
  designApproval: unknown;
  registeredOn: string;
  iconoir: { commit: string };
  icons: Record<string, RegisteredIcon>;
};

/** The fields the build reads; the bytes are already pinned, so this only keeps a reviewed bump honest. */
function checkRegistration(value: unknown): Registration {
  const record = value as Registration | null;
  const icons = record?.icons;
  if (typeof icons !== "object" || icons === null || Array.isArray(icons)) throw new Error("no icons object");
  for (const [name, icon] of Object.entries(icons))
    if (typeof icon?.iconoirName !== "string" || !/^[a-f0-9]{64}$/.test(String(icon.sourceSha256)))
      throw new Error(`icons.${name} lacks iconoirName or sourceSha256`);
  checkDrawings(Object.fromEntries(Object.entries(icons).map(([name, icon]) => [name, icon.drawings])));
  return record as Registration;
}

/** inventory.json is not hash-pinned, so a duplicate key (which JSON.parse silently drops) could hide a pointer. */
function uniqueKeysJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  // JSON.parse already proved the grammar. Canonicalize string/number tokens and remove only outside whitespace;
  // a duplicate key is the only information this round trip can lose in this closed, nonnumeric-keyed schema.
  const compact = text.replace(/"(?:[^"\\]|\\.)*"|\s+|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) =>
    /^\s/.test(token) ? "" : JSON.stringify(JSON.parse(token)),
  );
  if (compact !== JSON.stringify(value)) throw new Error("duplicate inventory keys");
  return value;
}

/** Only the hash-pinned optional Icon pointer may extend the immutable 36-icon sheet. */
function registeredIcons(io: IconsIo, sheetVersion: string) {
  try {
    const inventory = uniqueKeysJson(io.readText("inventory.json")) as { Icon?: { extensions?: unknown } } | null;
    const icon = inventory?.Icon;
    if (!icon || typeof icon !== "object" || Array.isArray(icon)) throw new Error("missing Icon inventory");
    if (!Object.hasOwn(icon, "extensions")) return undefined;
    // Only the fixed path is ever read; the pointer cannot name another file.
    const actual = io.sha256(EXTENSION);
    if (actual !== APPROVED_EXTENSION_SHA256)
      throw new IconsError(
        "icons.registration",
        `shared/ui/${EXTENSION} is sha256 ${actual}, expected ${APPROVED_EXTENSION_SHA256} (pinned in shared/ui-build/icons.ts)`,
      );
    if (JSON.stringify(icon.extensions) !== JSON.stringify([{ path: EXTENSION, sha256: actual }]))
      throw new Error("invalid Icon pointer");
    const record = checkRegistration(JSON.parse(io.readText(EXTENSION)));
    const base = record.baseSheet;
    if (
      sheetVersion !== base.version ||
      io.sha256(README) !== base.iconReadmeSha256 ||
      io.sha256(BUNDLE) !== base.bundleSha256
    )
      throw new IconsError("icons.source_mismatch", "registration does not match the immutable base sheet");
    return { record, sha256: actual };
  } catch (error) {
    if (error instanceof IconsError) throw error;
    throw new IconsError("icons.registration", `invalid or unreadable ${EXTENSION}: ${String(error)}`);
  }
}

/** Checks the copied files against the sheet and any fixed registration, then returns icons.json's text. */
function buildIcons(io: IconsIo): string {
  const sheetVersion = checkSource(io);
  const list = sheetList(io.readText(README));
  const drawings = sheetDrawings(io.readText(BUNDLE));
  const sheetNames = [...list.keys()].sort();
  if (JSON.stringify(Object.keys(drawings).sort()) !== JSON.stringify(sheetNames))
    throw new IconsError("icons.list_mismatch", "the sheet's ICONS must hold exactly the README's list");
  const extension = registeredIcons(io, sheetVersion);
  const additions: Readonly<Record<string, RegisteredIcon>> = extension?.record.icons ?? {};
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
  const drawn: Record<string, Drawn> = {};
  for (const [name, iconoir] of list) {
    const file = `${SVG_DIR}/${name}.svg.txt`;
    const elements = parseSvg(name, io.readText(file));
    if (!same(elements, drawings[name] ?? []))
      throw new IconsError("icons.drawing_mismatch", `${name}.svg (Iconoir ${iconoir}) differs from the sheet`);
    icons[name] = io.sha256(file);
    drawn[name] = elements.map(([, attributes]) => attributes);
  }
  const lucide = lucideDrawings(io, list);
  Object.assign(drawn, lucide.drawings);
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
    ...lucide.field,
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

const readOrNone = (io: IconsIo, path: string): string | undefined => {
  try {
    return io.readText(path);
  } catch {
    return undefined;
  }
};

const listOrNone = (io: IconsIo, dir: string): string[] => {
  try {
    return io.list(dir);
  } catch {
    return [];
  }
};

/** `icons.ts [--check]`: 0 when icons.json is (or now is) current; 1 with the error code. */
export function runIcons(args: string[], io: IconsIo, print: (line: string) => void): number {
  try {
    const json = buildIcons(io);
    if (readOrNone(io, OUT) === json) return 0;
    if (args.includes("--check")) throw new IconsError("icons.stale", `${OUT} differs; run node scripts/ui/icons.ts`);
    io.writeText(OUT, json);
    return 0;
  } catch (error) {
    print(error instanceof IconsError ? error.message : `icons.parse: ${String(error)}`);
    return 1;
  }
}
