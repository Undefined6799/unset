// Guard (P1.24q; step P1.24 "check-inventory"; decision 33): the UI kit holds only what the unset.sh design sheet
// defines. A component folder must be in shared/ui/inventory.json and a built entry must have its folder; a sheet
// README must still have the bytes recorded for it; a `stop` piece is never used in apps/; no icon package is imported,
// listed or locked; icons are the sheet's Iconoir 7.12.1 files, byte for byte and free of active content; and no other
// SVG exists in product code. The inventory is the base: if it cannot be read, that one finding is reported.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Finding, filesUnder, isTestFile, PRODUCT_DIRS, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

const RULE = "ui-inventory";
const UI = "shared/ui";
export const INVENTORY = `${UI}/inventory.json`;
const COMPONENTS = `${UI}/components`;
const ICONS_JSON = `${UI}/icons/icons.json`;
const ICON_SVGS = `${UI}/icons/svg`;
const ICONOIR_VERSION = "7.12.1";
/** The only files that draw an inline <svg>: the Icon component and the Mark, both from sheet geometry. */
export const INLINE_SVG_FILES: readonly string[] = [`${COMPONENTS}/Icon/Icon.tsx`, `${COMPONENTS}/Mark/Mark.tsx`];
/** Icon packages, by name or prefix, as the step lists them; the copied data under shared/ui/icons is files. */
const ICON_PACKAGE =
  /^(?:iconoir|lucide|@heroicons\/|react-icons(?:\/|$)|@tabler\/icons|@phosphor-icons\/|@fortawesome\/)/;
const UNSAFE_SVG = /<script|<style|<foreignobject|\son[a-z]+\s*=|href\s*=/i;
const DEPENDENCY_LISTS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

type Entry = { sheet: string; sheetSha256: string; status: string };
type Icons = { iconoirVersion: string; icons: Record<string, string> };

const finding = (file: string, text: string, line = 1): Finding => ({ file, line, rule: RULE, text });
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A JSON file's value, or a finding when it is missing, not UTF-8 or not JSON. */
function readJson<T>(root: string, file: string): T | Finding {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(root, file)))) as T;
  } catch {
    return finding(file, "unreadable");
  }
}
const isFinding = (value: unknown): value is Finding => (value as Finding | null)?.rule === RULE;

function checkComponents(root: string, inventory: Record<string, Entry>): Finding[] {
  const out: Finding[] = [];
  const dirs = existsSync(join(root, COMPONENTS))
    ? readdirSync(join(root, COMPONENTS), { withFileTypes: true }).filter((d) => d.isDirectory())
    : [];
  for (const dir of dirs)
    if (inventory[dir.name] === undefined) out.push(finding(`${COMPONENTS}/${dir.name}`, "not in inventory.json"));
  for (const [name, entry] of Object.entries(inventory)) {
    if (entry.status === "built" && !dirs.some((d) => d.name === name))
      out.push(finding(INVENTORY, `${name} is built but ${COMPONENTS}/${name} does not exist`));
    const readme = `${UI}/${entry.sheet}`;
    if (!existsSync(join(root, readme))) out.push(finding(INVENTORY, `${name}: ${readme} does not exist`));
    else if (sha256(readFileSync(join(root, readme))) !== entry.sheetSha256)
      out.push(finding(readme, `${name}: sheet README changed since recorded; re-review and update sheetSha256`));
  }
  return out;
}

function checkIcons(root: string, icons: Icons): Finding[] {
  const out: Finding[] = [];
  if (icons.iconoirVersion !== ICONOIR_VERSION)
    out.push(finding(ICONS_JSON, `iconoirVersion ${icons.iconoirVersion} is not the sheet's ${ICONOIR_VERSION}`));
  const files = existsSync(join(root, ICON_SVGS)) ? readdirSync(join(root, ICON_SVGS)) : [];
  for (const file of files) {
    const path = `${ICON_SVGS}/${file}`;
    const name = file.replace(/\.svg\.txt$/, "");
    const expected = icons.icons[name];
    if (name === file || expected === undefined) {
      out.push(finding(path, "not on the sheet's Icon list in icons.json"));
      continue;
    }
    const bytes = readFileSync(join(root, path));
    if (sha256(bytes) !== expected) out.push(finding(path, "sha256 differs from icons.json"));
    if (UNSAFE_SVG.test(bytes.toString("utf8"))) out.push(finding(path, "script, style, foreignObject, on* or href"));
  }
  for (const name of Object.keys(icons.icons))
    if (!files.includes(`${name}.svg.txt`))
      out.push(finding(ICONS_JSON, `${name}: ${ICON_SVGS}/${name}.svg.txt missing`));
  return out;
}

/** The names an `<Icon name=…>` on this line can take: a string, or each string literal in a `{…}` expression. */
function iconNames(line: string): string[] {
  const m = /<Icon\b[^>]*?\bname=(?:"([^"]*)"|\{([^}]*)\})/.exec(line);
  if (m === null) return [];
  if (m[1] !== undefined) return [m[1]];
  return [...(m[2] ?? "").matchAll(/"([^"]*)"/g)].map((s) => s[1] ?? "");
}

type SourceContext = { readonly icons: Set<string>; readonly stop: readonly string[] };

/** What is wrong with one source line, as reasons; `svgAllowed` is false only for product .tsx outside Icon and Mark. */
function lineProblems(file: string, text: string, ctx: SourceContext, svgAllowed: boolean): string[] {
  const why = specifiersOn(text)
    .filter((spec) => ICON_PACKAGE.test(spec))
    .map(() => "icon package import");
  for (const name of iconNames(text))
    if (!ctx.icons.has(name)) why.push(`icon "${name}" is not on the sheet's Icon list`);
  if (!svgAllowed && /<svg\b/.test(text)) why.push("inline <svg> outside the Icon and Mark components");
  if (file.startsWith("apps/"))
    for (const stop of ctx.stop)
      if (new RegExp(`<${stop}\\b|components/${stop}\\b|\\bimport\\b.*\\b${stop}\\b`).test(text))
        why.push(`${stop} is a stop item`);
  return why;
}

/** Every source line: icon package imports, unknown Icon names, inline <svg>, and stop pieces used in apps/. */
function scanSource(file: string, source: string, ctx: SourceContext): Finding[] {
  const svgAllowed = isTestFile(file) || INLINE_SVG_FILES.includes(file) || !file.endsWith(".tsx");
  return source
    .split("\n")
    .flatMap((text, i) =>
      lineProblems(file, text, ctx, svgAllowed).map((why) => finding(file, `${why}: ${text.trim()}`, i + 1)),
    );
}

/** Icon packages in any package.json dependency list. */
function manifestFindings(root: string): Finding[] {
  return filesUnder(root, ["."], /^package\.json$/).flatMap((file) => {
    const manifest = readJson<Record<string, unknown>>(root, file);
    if (isFinding(manifest)) return [manifest];
    return DEPENDENCY_LISTS.flatMap((list) =>
      Object.keys((manifest[list] as Record<string, string> | undefined) ?? {})
        .filter((name) => ICON_PACKAGE.test(name))
        .map((name) => finding(file, `icon package ${name} in ${list}`)),
    );
  });
}

/** Icon packages anywhere in the lockfile's package tree. */
function lockfileFindings(root: string): Finding[] {
  if (!existsSync(join(root, "package-lock.json"))) return [];
  const lock = readJson<{ packages?: Record<string, unknown> }>(root, "package-lock.json");
  if (isFinding(lock)) return [lock];
  const marker = "node_modules/";
  return Object.keys(lock.packages ?? {})
    .filter((path) => path.includes(marker) && ICON_PACKAGE.test(path.slice(path.lastIndexOf(marker) + marker.length)))
    .map((path) =>
      finding("package-lock.json", `icon package ${path.slice(path.lastIndexOf(marker) + marker.length)} locked`),
    );
}

/** SVG files in product folders outside the copied icons (docs/ assets such as the README banner are not product). */
const strayIconFiles = (root: string): Finding[] =>
  filesUnder(root, PRODUCT_DIRS, /\.svg(?:\.txt)?$/)
    .filter((file) => !file.startsWith(`${ICON_SVGS}/`))
    .map((file) => finding(file, "SVG file outside shared/ui/icons/svg"));

/** The source files the guard reads; the repository test checks there are some, so an empty scan cannot pass. */
export const scannedFiles = (root: string): string[] => sourceFiles(root, [...PRODUCT_DIRS, "scripts"]);

export function scanAll(root: string): Finding[] {
  const inventory = readJson<Record<string, Entry>>(root, INVENTORY);
  if (isFinding(inventory)) return [inventory];
  const icons = readJson<Icons>(root, ICONS_JSON);
  const iconFindings = isFinding(icons) ? [icons] : checkIcons(root, icons);
  const ctx = {
    icons: new Set(isFinding(icons) ? [] : Object.keys(icons.icons)),
    stop: Object.entries(inventory)
      .filter(([, entry]) => entry.status === "stop")
      .map(([name]) => name),
  };
  return [
    ...checkComponents(root, inventory),
    ...iconFindings,
    ...manifestFindings(root),
    ...lockfileFindings(root),
    ...strayIconFiles(root),
    ...scanFiles(root, scannedFiles(root), RULE, (file, source) => scanSource(file, source, ctx)),
  ].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
