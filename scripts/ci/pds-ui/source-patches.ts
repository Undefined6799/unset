// ADR 0027: independent byte verification, never a product applicator or auth-semantic oracle.
// Node26.10 builtins: node:buffer isUtf8; @types/node26.6.5 buffer.d.ts / crypto.d.ts.
import { isUtf8 } from "node:buffer";
import { type Entry, requireThat, sha256 } from "./archive.ts";

export const PATCH_DIRECTORY = "deployment/pds/patches/ui/";
export const TARGETS: Readonly<Record<string, string>> = {
  "packages/oauth/oauth-provider-ui/src/components/layouts/account-shell.tsx":
    "2660a358e58945d9c399bd24a99170bcdff47f0024e0311a432facf8b91245fb",
  "packages/oauth/oauth-provider-ui/src/components/session-list.tsx":
    "d24f13894ab4cbad910726a7e46ea8f73968785f48fab1e1ead665026e397b2d",
  "packages/oauth/oauth-provider-ui/src/routes/account/u/$accountId/devices.tsx":
    "e08f8848c183779b6c62df7cd4b22d00eebb46ac47273151657975b6b657f8e5",
};
const LIMIT = 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
type Patch = { patch: string; target: string; inputSha256: string; outputSha256: string; patchSha256: string };

/** Recursive code-unit object-key order, two spaces and one final LF; array order is meaningful. */
export function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item !== null && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sorted(v)]),
      );
    return item;
  };
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}
export function boundedText(bytes: Buffer, limit = LIMIT): string {
  requireThat(bytes.length > 0 && bytes.length <= limit && isUtf8(bytes), "text size/UTF8");
  const text = bytes.toString("utf8");
  requireThat(text.endsWith("\n") && !/[\r\0\uFEFF]/u.test(text), "text must be LF without BOM/NUL");
  return text;
}
export function parseCanonical(bytes: Buffer): unknown {
  const text = boundedText(bytes, 65536);
  const value: unknown = JSON.parse(text);
  requireThat(canonical(value) === text, "noncanonical or duplicate JSON keys");
  return value;
}
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "expected object");
  requireThat(Object.keys(value).sort().join() === expected.sort().join(), "unexpected object fields");
}
export function patchManifest(bytes: Buffer): Patch[] {
  const value = parseCanonical(bytes);
  keys(value, ["schema", "patches"]);
  requireThat(value.schema === 1 && Array.isArray(value.patches), "invalid patch manifest");
  const rows = value.patches as Patch[];
  requireThat(rows.length === 0 || rows.length === 3, "incomplete Devices cohort");
  const names = new Set<string>();
  let previous = "";
  for (const row of rows) {
    keys(row, ["patch", "target", "inputSha256", "outputSha256", "patchSha256"]);
    requireThat(
      typeof row.target === "string" && Object.hasOwn(TARGETS, row.target) && row.target > previous,
      "unregistered/duplicate/unsorted patch target",
    );
    requireThat(
      typeof row.patch === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*\.patch$/.test(row.patch) && !names.has(row.patch),
      "invalid/duplicate patch basename",
    );
    requireThat(
      [row.inputSha256, row.outputSha256, row.patchSha256].every((hash) => typeof hash === "string" && HASH.test(hash)),
      "invalid patch hashes",
    );
    requireThat(
      row.inputSha256 === TARGETS[row.target] && row.outputSha256 !== row.inputSha256,
      "unregistered input or unchanged output",
    );
    names.add(row.patch);
    previous = row.target;
  }
  return rows;
}

function hunkBody(
  source: string[],
  lines: string[],
  startLine: number,
  startCursor: number,
  oldCount: number,
  nextCount: number,
) {
  const output: string[] = [];
  let line = startLine;
  let cursor = startCursor;
  let removed = 0;
  let added = 0;
  let changed = false;
  while (line < lines.length && !lines[line]?.startsWith("@@")) {
    const body = lines[line++] as string;
    const control = body[0];
    const text = body.slice(1);
    requireThat(control === " " || control === "+" || control === "-", "invalid hunk body");
    if (control !== "+") {
      requireThat(source[cursor] === text && ++removed <= oldCount, "hunk context/count mismatch");
      cursor++;
    }
    if (control !== "-") {
      requireThat(++added <= nextCount, "hunk output count mismatch");
      output.push(text);
    }
    changed ||= control !== " ";
  }
  requireThat(removed === oldCount && added === nextCount, "truncated hunk");
  return { line, cursor, output, changed };
}

/** Positional reconstruction only: no search, offset, fuzz, whitespace normalization or writes. */
export function exactPatch(original: Buffer, patch: Buffer, target: string): Buffer {
  const source = boundedText(original).slice(0, -1).split("\n");
  const lines = boundedText(patch).slice(0, -1).split("\n");
  requireThat(lines[0] === `--- a/${target}` && lines[1] === `+++ b/${target}`, "unexpected patch headers");
  const output: string[] = [];
  let cursor = 0;
  let line = 2;
  let hunks = 0;
  let changed = false;
  while (line < lines.length) {
    const header = /^@@ -([1-9][0-9]*),([1-9][0-9]*) \+([1-9][0-9]*),([1-9][0-9]*) @@$/.exec(lines[line++] ?? "");
    requireThat(header && ++hunks <= 128, "invalid hunk header/count");
    const [old, oldCount, next, nextCount] = header.slice(1).map(Number) as [number, number, number, number];
    requireThat(
      [old, oldCount, next, nextCount].every(Number.isSafeInteger) &&
        old - 1 >= cursor &&
        old - 1 + oldCount <= source.length,
      "hunk range/overlap",
    );
    for (const unchanged of source.slice(cursor, old - 1)) output.push(unchanged);
    cursor = old - 1;
    requireThat(next - 1 === output.length, "hunk output coordinate");
    const body = hunkBody(source, lines, line, cursor, oldCount, nextCount);
    line = body.line;
    cursor = body.cursor;
    for (const added of body.output) output.push(added);
    changed ||= body.changed;
  }
  requireThat(hunks > 0 && changed, "empty patch");
  for (const unchanged of source.slice(cursor)) output.push(unchanged);
  const result = Buffer.from(`${output.join("\n")}\n`);
  requireThat(result.length <= LIMIT && !result.equals(original), "output limit/unchanged patch");
  return result;
}

/** Source must be the map returned by authenticated verifySource; no link resolution is allowed. */
export function planPatches(
  source: Map<string, Entry>,
  revision: string,
  inputs: Map<string, Buffer>,
): Map<string, Buffer> {
  const raw = inputs.get(`${PATCH_DIRECTORY}manifest.json`);
  requireThat(raw, "missing patch manifest");
  const rows = patchManifest(raw);
  const expected = new Set([`${PATCH_DIRECTORY}manifest.json`, ...rows.map((row) => `${PATCH_DIRECTORY}${row.patch}`)]);
  const actual = [...inputs.keys()].filter((path) => path.startsWith(PATCH_DIRECTORY));
  requireThat(
    actual.length === expected.size && actual.every((path) => expected.has(path)),
    "patch inventory mismatch",
  );
  const plans = new Map<string, Buffer>();
  for (const row of rows) {
    const entry = source.get(`atproto-${revision}/${row.target}`);
    const patch = inputs.get(`${PATCH_DIRECTORY}${row.patch}`);
    requireThat(
      entry?.header.type === "file" &&
        sha256(entry.data) === row.inputSha256 &&
        patch &&
        sha256(patch) === row.patchSha256,
      "patch input/type/hash mismatch",
    );
    const result = exactPatch(entry.data, patch, row.target);
    requireThat(sha256(result) === row.outputSha256, "patch output hash mismatch");
    plans.set(row.target, result);
  }
  return plans;
}
