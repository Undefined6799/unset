// The legal documents' markdown (P2.15). Parsed once, when the module loads, into blocks the request only fills.
// There is no HTML pass-through: text stays text (React escapes it) and a link is kept only when safeHref accepts
// it (shared/ui/safe-href.ts, P1.24h). A hole is {{name}} and is substituted later, never concatenated into HTML.
import { type SafeHref, safeHref } from "@unset/shared-ui";

const LEGAL_HOLES = ["privacyOfficerTitle", "privacyOfficerContact", "supportEmail", "pdsHost"] as const;
export type LegalHole = (typeof LEGAL_HOLES)[number];
export type LegalValues = Record<LegalHole, string>;

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: SafeHref; readonly children: readonly Inline[] }
  | { readonly kind: "hole"; readonly name: LegalHole };

export type Block =
  | { readonly kind: "h"; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly kind: "p"; readonly children: readonly Inline[] }
  | { readonly kind: "ul"; readonly items: readonly (readonly Inline[])[] }
  | {
      readonly kind: "table";
      readonly headers: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    };

export type LegalDocument = {
  readonly version: string | null;
  readonly source: string;
  readonly blocks: readonly Block[];
};

const HOLES: readonly string[] = LEGAL_HOLES;

function fail(line: number, why: string): never {
  throw new Error(`legal markdown:${line}: ${why}`);
}

type Taken = { readonly inline: Inline; readonly next: number };

function takeHole(text: string, i: number, line: number): Taken | null {
  if (!text.startsWith("{{", i)) return null;
  const end = text.indexOf("}}", i + 2);
  if (end === -1) fail(line, "unclosed hole");
  const name = text.slice(i + 2, end);
  if (!HOLES.includes(name)) fail(line, "unknown hole");
  return { inline: { kind: "hole", name: name as LegalHole }, next: end + 2 };
}

function takeStrong(text: string, i: number, line: number, allowStrong: boolean): Taken | null {
  if (!allowStrong || !text.startsWith("**", i)) return null;
  const end = text.indexOf("**", i + 2);
  if (end === -1) fail(line, "unclosed strong");
  return { inline: { kind: "strong", children: parseInlines(text.slice(i + 2, end), line, false) }, next: end + 2 };
}

function takeLink(text: string, i: number, line: number, allowStrong: boolean): Taken | null {
  if (text[i] !== "[") return null;
  const labelEnd = text.indexOf("](", i + 1);
  if (labelEnd === -1) return null;
  const hrefEnd = text.indexOf(")", labelEnd + 2);
  if (hrefEnd === -1) return null;
  const href = safeHref(text.slice(labelEnd + 2, hrefEnd), ["https:", "mailto:", "path"]);
  if (href === null) fail(line, "link refused");
  const children = parseInlines(text.slice(i + 1, labelEnd), line, allowStrong);
  if (children.length === 0) fail(line, "empty link");
  return { inline: { kind: "link", href, children }, next: hrefEnd + 1 };
}

function parseInlines(text: string, line: number, allowStrong: boolean): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer === "") return;
    out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  for (let i = 0; i < text.length; ) {
    const taken =
      takeHole(text, i, line) ?? takeStrong(text, i, line, allowStrong) ?? takeLink(text, i, line, allowStrong);
    if (taken) {
      flush();
      out.push(taken.inline);
      i = taken.next;
      continue;
    }
    const character = text[i];
    if (character === undefined) break;
    buffer += character;
    i += 1;
  }
  flush();
  return out;
}

function cells(line: string, number: number): Inline[][] {
  const parts = line.split("|").slice(1, -1);
  if (parts.length === 0 || !line.trim().startsWith("|") || !line.trim().endsWith("|")) fail(number, "table row");
  return parts.map((part) => parseInlines(part.trim(), number, true));
}

function isRule(line: string): boolean {
  const parts = line.trim().split("|").slice(1, -1);
  return parts.length > 0 && parts.every((part) => /^:?-{3,}:?$/.test(part.trim()));
}

function frontMatter(lines: readonly string[]): { version: string | null; bodyAt: number } {
  if (lines[0] !== "---") return { version: null, bodyAt: 0 };
  const end = lines.indexOf("---", 1);
  if (end === -1) fail(1, "unclosed front matter");
  const versionLine = lines.slice(1, end).find((line) => line.startsWith("version:"));
  if (versionLine === undefined) fail(1, "version missing");
  const version = versionLine.slice("version:".length).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) fail(1, "version is not a date");
  return { version, bodyAt: end + 1 };
}

function headingLevel(marks: string, line: number): 1 | 2 | 3 {
  if (marks === "#") return 1;
  if (marks === "##") return 2;
  if (marks === "###") return 3;
  return fail(line, "heading too deep");
}

function headingBlock(line: string, number: number): Block | null {
  if (line.startsWith("####")) fail(number, "heading too deep");
  const heading = /^(#{1,3}) (.+)$/.exec(line);
  if (!heading) return null;
  const children = parseInlines(heading[2] ?? "", number, true);
  if (children.length === 0) fail(number, "empty heading");
  return { kind: "h", level: headingLevel(heading[1] ?? "", number), children };
}

function listBlock(at: (index: number) => string, i: number): { block: Block; next: number } | null {
  if (!at(i).startsWith("- ")) return null;
  const items: Inline[][] = [];
  let next = i;
  while (at(next).startsWith("- ")) {
    const item = parseInlines(at(next).slice(2), next + 1, true);
    if (item.length === 0) fail(next + 1, "empty list item");
    items.push(item);
    next += 1;
  }
  return { block: { kind: "ul", items }, next };
}

function tableBlock(at: (index: number) => string, i: number): { block: Block; next: number } | null {
  const line = at(i);
  if (!line.trim().startsWith("|")) return null;
  const headers = cells(line, i + 1);
  if (!isRule(at(i + 1))) fail(i + 1, "table has no rule");
  const rows: Inline[][][] = [];
  let next = i + 2;
  while (at(next).trim().startsWith("|")) {
    const row = cells(at(next), next + 1);
    if (row.length !== headers.length) fail(next + 1, "table row width");
    rows.push(row);
    next += 1;
  }
  if (rows.length === 0) fail(i + 1, "empty table");
  return { block: { kind: "table", headers, rows }, next };
}

function isParagraphLine(line: string): boolean {
  if (line.trim() === "") return false;
  if (line.startsWith("#") || line.startsWith("- ") || line.trim().startsWith("|")) return false;
  return !/^<!-- .* -->$/.test(line.trim());
}

function paragraphBlock(at: (index: number) => string, i: number): { block: Block; next: number } {
  const paragraph: string[] = [];
  let next = i;
  while (isParagraphLine(at(next))) {
    paragraph.push(at(next));
    next += 1;
  }
  if (paragraph.length === 0) fail(i + 1, "unrecognised line");
  return { block: { kind: "p", children: parseInlines(paragraph.join(" "), i + 1, true) }, next };
}

function isSkipped(line: string): boolean {
  return line.trim() === "" || /^<!-- .* -->$/.test(line.trim());
}

/** Parses one document. `source` is what the marker and changelog tests scan; `blocks` are what the page renders. */
export function parseLegal(raw: string): LegalDocument {
  const source = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = source.split("\n");
  const { version, bodyAt } = frontMatter(lines);
  const blocks: Block[] = [];
  const at = (index: number) => lines[index] ?? "";
  let i = bodyAt;
  while (i < lines.length) {
    if (isSkipped(at(i))) {
      i += 1;
      continue;
    }
    const heading = headingBlock(at(i), i + 1);
    if (heading) {
      blocks.push(heading);
      i += 1;
      continue;
    }
    const list = listBlock(at, i);
    if (list) {
      blocks.push(list.block);
      i = list.next;
      continue;
    }
    const table = tableBlock(at, i);
    if (table) {
      blocks.push(table.block);
      i = table.next;
      continue;
    }
    const paragraph = paragraphBlock(at, i);
    blocks.push(paragraph.block);
    i = paragraph.next;
  }
  if (blocks.length === 0) fail(1, "empty document");
  return { version, source, blocks };
}

/** Checklist ids whose `<!-- id -->` marker is missing from the document source. */
export function missingMarkers(source: string, ids: readonly string[]): string[] {
  return ids.filter((id) => !source.includes(`<!-- ${id} -->`));
}

/** A problem when `version` has no changelog line, or null when the Changes section names it. */
export function changelogProblem(source: string, version: string): string | null {
  const changes = source.split(/^## Changes\s*$/m)[1];
  if (changes === undefined) return "no changes section";
  if (!changes.includes(version)) return "version missing from changes";
  return null;
}
