// P1.25i (docs/ai/book/phase-1.md): the copies stay byte-identical to the originals after one
// listed import-specifier map. The originals are read by these paths and never imported or run.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** The four runtime sources. A missing original passes only for the first two, by exact path. */
const PAIRS = [
  { original: "shared/ui/islands/define.ts", copy: "shared/islands/define.ts" },
  { original: "shared/ui/islands/slot.ts", copy: "shared/islands/slot.ts" },
  { original: "shared/ui/islands/props.ts", copy: "shared/islands/props.ts" },
  { original: "shared/ui/src/islands/readProps.ts", copy: "shared/islands/readProps.ts" },
] as const;

const MISSING_ORIGINAL_PASSES: readonly string[] = ["shared/ui/islands/define.ts", "shared/ui/islands/slot.ts"];

/**
 * Exact quoted specifiers, applied with split/join. A longer path that merely starts with one of
 * these strings is left alone, because the quotes are part of the match.
 */
const SPECIFIERS: readonly { from: string; to: string }[] = [{ from: '"../../islands/props.ts"', to: '"./props.ts"' }];

type Files = (path: string) => string | undefined;
/** An override that means the path is absent. Distinct from "not overridden". */
const MISSING = Symbol("missing");
type Override = string | typeof MISSING;

function applySpecifiers(source: string): string {
  let text = source;
  for (const { from, to } of SPECIFIERS) text = text.split(from).join(to);
  return text;
}

/** Why the copies are not the mapped originals. Empty means they match. */
function parityFailures(read: Files): string[] {
  const failures: string[] = [];
  for (const pair of PAIRS) {
    const copy = read(pair.copy);
    if (copy === undefined) {
      failures.push(`${pair.copy} missing`);
      continue;
    }
    const original = read(pair.original);
    if (original === undefined) {
      if (!MISSING_ORIGINAL_PASSES.includes(pair.original)) failures.push(`${pair.original} missing`);
      continue;
    }
    if (applySpecifiers(original) !== copy) failures.push(`${pair.copy} differs from ${pair.original}`);
  }
  return failures;
}

/** Every pair path reads `same\n` unless `over` sets its text or marks it missing. */
function filled(over: (path: string) => Override | undefined): Files {
  return (path) => {
    const hit = over(path);
    if (hit === MISSING) return undefined;
    if (typeof hit === "string") return hit;
    return PAIRS.some((pair) => pair.original === path || pair.copy === path) ? "same\n" : undefined;
  };
}

function readRepo(path: string): string | undefined {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : undefined;
}

test("copies_match_originals", () => {
  expect(parityFailures(readRepo)).toEqual([]);
});

test("one_byte_change_fails", () => {
  // `same\n` against `samf\n`: one byte, the fourth character.
  const read = filled((path) => (path === "shared/islands/define.ts" ? "samf\n" : undefined));
  expect(parityFailures(read)).toEqual(["shared/islands/define.ts differs from shared/ui/islands/define.ts"]);
});

test.each(PAIRS.map((pair) => pair.copy))("missing_copy_fails %s", (copy) => {
  const read = filled((path) => (path === copy ? MISSING : undefined));
  expect(parityFailures(read)).toEqual([`${copy} missing`]);
});

test.each(MISSING_ORIGINAL_PASSES)("missing_original_passes %s", (original) => {
  const read = filled((path) => (path === original ? MISSING : undefined));
  expect(parityFailures(read)).toEqual([]);
});

test.each(["shared/ui/islands/props.ts", "shared/ui/src/islands/readProps.ts"])(
  "missing_original_fails %s",
  (original) => {
    const read = filled((path) => (path === original ? MISSING : undefined));
    expect(parityFailures(read)).toEqual([`${original} missing`]);
  },
);

test("specifier_map_is_exact", () => {
  const original = 'import type { JsonValue } from "../../islands/props.ts";\n';
  const longer = 'import type { JsonValue } from "../../islands/props.ts.bak";\n';
  expect(applySpecifiers(original)).toBe('import type { JsonValue } from "./props.ts";\n');
  expect(applySpecifiers(longer)).toBe(longer);
  const read = filled((path) => {
    if (path === "shared/ui/src/islands/readProps.ts") return original;
    if (path === "shared/islands/readProps.ts") return applySpecifiers(original);
    return undefined;
  });
  expect(parityFailures(read)).toEqual([]);
});
