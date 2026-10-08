// The tooling set (P1.28p; architecture p130s amendments 11 and 11a in 2026-10-07-p130s-networks-and-caddyfile-reader.md;
// step book 2026-10-08-p128p-product-never-imports-tooling.md): the files that never ship, so product code never
// imports them. Defined once here; the depcruise rule `no-product-imports-tooling-set` and P1.28m's test-file check
// in specifiers.ts both read it. Patterns are regular-expression sources, because depcruise paths are.
import VITEST from "../../vitest.config.ts";

/** The Vitest `include` globs of every project, read from the root vitest.config.ts rather than copied. */
export const TEST_GLOBS: string[] = (VITEST.test?.projects ?? []).flatMap((project) =>
  typeof project === "object" && "test" in project ? (project.test?.include ?? []) : [],
);

/**
 * A glob as `path.matchesGlob` reads it (Node v26.10.0 doc/api/path.md, "path.matchesGlob"), for the forms the
 * Vitest config writes: a double-star directory segment, `*` and `{a,b}`. Like matchesGlob, a wildcard never matches
 * a name starting with a dot. Any other glob syntax throws, so a new form cannot be read wrongly; the tests compare
 * it with matchesGlob.
 */
export function globSource(glob: string): string {
  if (/\*\*(?!\/)/.test(glob)) throw new Error(`glob ${glob}: a double star is read only before a slash`);
  const tokens = glob.split(/(\*\*\/|\*|\{[^}]*\})/).filter((token) => token !== "");
  return `^${tokens.map((token, n) => tokenSource(glob, token, n === 0 || tokens[n - 1]?.endsWith("/") === true)).join("")}$`;
}

function tokenSource(glob: string, token: string, segmentStart: boolean): string {
  // Any directories, none starting with a dot; written without a nested repeat, which depcruise refuses as unsafe.
  if (token === "**/") return "(?!\\.|.*/\\.)(?:.*/|)";
  if (token === "*") return segmentStart ? "[^/.][^/]*" : "[^/]*";
  if (token.startsWith("{")) return `(?:${token.slice(1, -1).split(",").map(escapeRegex).join("|")})`;
  if (/^[A-Za-z0-9._/-]+$/.test(token)) return escapeRegex(token);
  throw new Error(`glob ${glob}: ${token} is not read here`);
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A file Vitest runs as a test: the part of the tooling set P1.28m lets fall back to the root package.json. */
export const TEST_FILE = TEST_GLOBS.map(globSource).join("|");

/** Every pattern of the tooling set (step book P1.28p "What"), each matched against a repo-relative path. */
export const TOOLING_SET: string[] = [
  TEST_FILE,
  "^tests/",
  // The SE-6 check paths (amendment 11a): scripts/ui is product and stays outside.
  "^scripts/(guards|lint|ci|budgets|licence|docs|test|workspace|githooks)/",
  "^vitest\\.config\\.ts$",
  "(^|/)(fixtures|__fixtures__)/",
  "\\.fixture\\.[^/]*$",
  "\\.vector\\.json$",
  // The record's **/*.image.test.*, any extension; TEST_FILE keeps Vitest's own, so the P1.28m fallback stays narrow.
  "\\.image\\.test\\.[^/]*$",
];

export const TOOLING_PATTERN = TOOLING_SET.map((source) => `(?:${source})`).join("|");
