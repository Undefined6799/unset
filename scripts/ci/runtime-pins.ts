// Which runtime base pins a pull request adds or changes (P1.34m, record
// unset-plan/book-edits/2026-10-13-p134m-pr-scan-new-runtime-pins.md). images.yml's `pins` job scans only these, so
// a new pin is scanned before it merges, and an unchanged pin's standing findings stay with mirror.yml's own run.
//
// A pin is its `ref:tag@digest` (the mirror list's spelling, mirror.yml) and its `stripped` set, because a different
// set changes what the scan leaves out. A pin present in the head lock but not in the base lock, among `runtime`
// entries, is selected; a removed pin is not. Build-only bases are left to mirror.yml.
//
// CLI: `node scripts/ci/runtime-pins.ts BASE_LOCK HEAD_LOCK` prints the selection as JSON. A missing base lock reads
// as empty (the lock's first PR); a missing or malformed head lock fails. Node 26.10.0 runs this file directly.
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

export type RuntimePin = { source: string; stripped: string[] };

// The selection reaches shell arguments and log lines in images.yml, so every field is held to a narrow grammar: a
// newline could start a workflow command, and a glob or `..` could widen a skip. Reference and tag grammar from
// distribution/reference (github.com/distribution/reference/blob/v0.6.0/regexp.go, domainAndPath, tag), lower-case
// and without the IPv6 form; the stripped-path rule is images.test.ts's STRIPPED_PATH.
const REF = /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)+$/;
const TAG = /^\w[\w.-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STRIPPED_PATH = /^(?:\/[\w.@+-]+){3,}$/;

function field(value: unknown, rule: RegExp, label: string, name: string): string {
  if (typeof value !== "string" || !rule.test(value)) throw new Error(`lock entry ${name}: ${label} is malformed`);
  return value;
}

function strippedOf(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  const ok = (path: unknown) => typeof path === "string" && STRIPPED_PATH.test(path) && posix.normalize(path) === path;
  if (!Array.isArray(value) || !value.every(ok)) throw new Error(`lock entry ${name}: stripped is malformed`);
  return [...value].sort();
}

/** The runtime pins of one lock, keyed by their identity. Throws on anything that is not a well-formed lock. */
function runtimePins(lock: unknown): Map<string, RuntimePin> {
  if (typeof lock !== "object" || lock === null || Array.isArray(lock)) throw new Error("lock is not an object");
  const pins = new Map<string, RuntimePin>();
  for (const [name, raw] of Object.entries(lock)) {
    if (typeof raw !== "object" || raw === null) throw new Error(`lock entry ${name} is not an object`);
    const entry = raw as Record<string, unknown>;
    const ref = field(entry.ref, REF, "ref", name);
    const source = `${ref}:${field(entry.tag, TAG, "tag", name)}@${field(entry.digest, DIGEST, "digest", name)}`;
    const stripped = strippedOf(entry.stripped, name);
    if (typeof entry.stage !== "string") throw new Error(`lock entry ${name}: stage is malformed`);
    if (entry.stage !== "runtime") continue;
    pins.set(JSON.stringify([source, stripped]), { source, stripped });
  }
  return pins;
}

/** Runtime pins in `head` that `base` does not hold, in the head lock's order. */
export function changedRuntimePins(base: unknown, head: unknown): RuntimePin[] {
  const before = runtimePins(base);
  return [...runtimePins(head)].filter(([key]) => !before.has(key)).map(([, pin]) => pin);
}

function main(): void {
  const [basePath, headPath] = process.argv.slice(2);
  if (basePath === undefined || headPath === undefined) throw new Error("usage: runtime-pins.ts BASE_LOCK HEAD_LOCK");
  const base: unknown = existsSync(basePath) ? JSON.parse(readFileSync(basePath, "utf8")) : {};
  const head: unknown = JSON.parse(readFileSync(headPath, "utf8"));
  console.log(JSON.stringify(changedRuntimePins(base, head)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
