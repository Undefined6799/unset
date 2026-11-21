// Guard (P1.24q; step P1.24 "check-inventory"; decision 33): the UI holds only what the unset.sh design sheet
// defines. shared/ui/inventory.json records the sheet's components (the React kit that built them went with P1.20k;
// the Svelte UI keeps its own list, apps/web/lib/components/inventory.json, ADR 0055); a sheet
// README must still have the bytes recorded for it; no icon package is imported,
// listed or locked; icons are the sheet's Iconoir 7.12.1 files (plus ADR 0087's one Lucide 1.72.0 grip), byte for byte and free of active content; and no other
// SVG exists in product code. The inventory is the base: if it cannot be read, that one finding is reported.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Finding, filesUnder, isTestFile, PRODUCT_DIRS, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

const RULE = "ui-inventory";
const UI = "shared/ui";
export const INVENTORY = `${UI}/inventory.json`;
const ICONS_JSON = `${UI}/icons/icons.json`;
const ICON_SVGS = `${UI}/icons/svg`;
const ICONOIR_VERSION = "7.12.1";
/** ADR 0087: the one second icon source, Lucide at this version, its files pinned in icons.json's `lucide`. */
const ICON_LUCIDE = `${UI}/icons/lucide`;
const LUCIDE_VERSION = "1.72.0";
/** The only file that draws an inline <svg>: the Svelte Icon (P1.20c), from the icons.json data. */
export const INLINE_SVG_FILES: readonly string[] = ["apps/web/lib/components/icon/icon.svelte"];
/**
 * Icon packages, by name or prefix, as the step lists them, plus the @lucide scope shadcn-svelte imports (P1.20c);
 * the copied data under shared/ui/icons is files.
 */
const ICON_PACKAGE =
  /^(?:iconoir|lucide|@lucide\/|@heroicons\/|react-icons(?:\/|$)|@tabler\/icons|@phosphor-icons\/|@fortawesome\/)/;
const UNSAFE_SVG = /<script|<style|<foreignobject|\son[a-z]+\s*=|href\s*=/i;
const DEPENDENCY_LISTS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

type Entry = { sheet: string; sheetSha256: string; status: string };
type Icons = {
  iconoirVersion: string;
  icons: Record<string, string>;
  lucide?: { version: string; icons: Record<string, { sha256: string }> };
};

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
  for (const [name, entry] of Object.entries(inventory)) {
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
  if (icons.lucide !== undefined && icons.lucide.version !== LUCIDE_VERSION)
    out.push(finding(ICONS_JSON, `lucide version ${icons.lucide.version} is not ADR 0087's ${LUCIDE_VERSION}`));
  const lucide = Object.fromEntries(Object.entries(icons.lucide?.icons ?? {}).map(([n, pin]) => [n, pin.sha256]));
  return [...out, ...checkIconFiles(root, ICON_SVGS, icons.icons), ...checkIconFiles(root, ICON_LUCIDE, lucide)];
}

/** Each copied file in `dir` against its pinned sha256, and each pinned name against its file. */
function checkIconFiles(root: string, dir: string, pins: Record<string, string>): Finding[] {
  const out: Finding[] = [];
  const files = existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : [];
  for (const file of files) {
    const path = `${dir}/${file}`;
    const name = file.replace(/\.svg\.txt$/, "");
    const expected = Object.hasOwn(pins, name) ? pins[name] : undefined;
    if (name === file || expected === undefined) {
      out.push(finding(path, "not on the sheet's Icon list in icons.json"));
      continue;
    }
    const bytes = readFileSync(join(root, path));
    if (sha256(bytes) !== expected) out.push(finding(path, "sha256 differs from icons.json"));
    if (UNSAFE_SVG.test(bytes.toString("utf8"))) out.push(finding(path, "script, style, foreignObject, on* or href"));
  }
  for (const name of Object.keys(pins))
    if (!files.includes(`${name}.svg.txt`)) out.push(finding(ICONS_JSON, `${name}: ${dir}/${name}.svg.txt missing`));
  return out;
}

/** The names an `<Icon name=…>` on this line can take: a string, or each string literal in a `{…}` expression. */
function iconNames(line: string): string[] {
  const m = /<Icon\b[^>]*?\bname=(?:"([^"]*)"|\{([^}]*)\})/.exec(line);
  if (m === null) return [];
  if (m[1] !== undefined) return [m[1]];
  return [...(m[2] ?? "").matchAll(/"([^"]*)"/g)].map((s) => s[1] ?? "");
}

type SourceContext = { readonly icons: Set<string> };

/** What is wrong with one source line, as reasons; `svgAllowed` is false for product .tsx and .svelte outside the Icon. */
function lineProblems(text: string, ctx: SourceContext, svgAllowed: boolean): string[] {
  const why = specifiersOn(text)
    .filter((spec) => ICON_PACKAGE.test(spec))
    .map(() => "icon package import");
  for (const name of iconNames(text))
    if (!ctx.icons.has(name)) why.push(`icon "${name}" is not on the sheet's Icon list`);
  if (!svgAllowed && /<svg\b/.test(text)) why.push("inline <svg> outside the Icon component");
  return why;
}

/** Every source line: icon package imports, unknown Icon names and inline <svg>. */
function scanSource(file: string, source: string, ctx: SourceContext): Finding[] {
  const svgAllowed = isTestFile(file) || INLINE_SVG_FILES.includes(file) || !/\.(?:tsx|svelte)$/.test(file);
  return source
    .split("\n")
    .flatMap((text, i) =>
      lineProblems(text, ctx, svgAllowed).map((why) => finding(file, `${why}: ${text.trim()}`, i + 1)),
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
    .filter((file) => !file.startsWith(`${ICON_SVGS}/`) && !file.startsWith(`${ICON_LUCIDE}/`))
    .map((file) => finding(file, "SVG file outside shared/ui/icons/svg"));

/** The source files the guard reads; the repository test checks there are some, so an empty scan cannot pass. */
export const scannedFiles = (root: string): string[] => sourceFiles(root, [...PRODUCT_DIRS, "scripts"]).sort();

export function scanAll(root: string): Finding[] {
  const inventory = readJson<Record<string, Entry>>(root, INVENTORY);
  if (isFinding(inventory)) return [inventory];
  const icons = readJson<Icons>(root, ICONS_JSON);
  const iconFindings = isFinding(icons) ? [icons] : checkIcons(root, icons);
  const names = isFinding(icons) ? [] : [...Object.keys(icons.icons), ...Object.keys(icons.lucide?.icons ?? {})];
  const ctx = { icons: new Set(names) };
  return [
    ...checkComponents(root, inventory),
    ...iconFindings,
    ...manifestFindings(root),
    ...lockfileFindings(root),
    ...strayIconFiles(root),
    ...scanFiles(root, scannedFiles(root), RULE, (file, source) => scanSource(file, source, ctx)),
  ].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
