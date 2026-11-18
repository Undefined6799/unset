// The trusted base (P0.09c; rule SE-6 as amended by ADR 0044, plan §9): the written list of paths whose changes are
// security changes. `.github/CODEOWNERS`'s last section is that one list. A pull request that changes a listed path
// carries the `security-review` label, so the change is named before anyone reads the diff. Who may merge it is in
// ADR 0044 and ADR 0019: the recorded review of the exact head, and Alex's own line when it loosens anything.
// The reader fails closed: a section it cannot read is an error, never "no trusted base".

export type TrustedBase = { patterns: string[]; parsedPaths: string[]; trustedFunctions: string[]; checks: string[] };
export type TrustedBaseRead = { ok: true; section: TrustedBase } | { ok: false; error: string };

const HEADING = "# trusted base (SE-6)";
const PARSED = "# parsed:";
/** The database functions SE-6 names. Nothing here parses SQL any more (ADR 0044): every migration is a trusted path,
 * and this line stays as the reviewer's list of what to look for in one. */
const FUNCTIONS = "# trusted functions:";
/** Check paths (ruling 2026-10-05, refined 01:15Z): what decides whether CI passes. CI runs the PR's own copy, so a
 * change to one is a change to the judge, and it is named like any other trusted path. */
const CHECKS = "# checks:";

// The one wildcard form a trusted pattern may take: a folder, a double star, then a file name (P1.20k).
const DEEP_NAME = /^\/([^*?[\]!\\]+\/)\*\*\/([^*?[\]!\\/]+)$/;

/** The path patterns and the three `#` lists of the section's lines, or an error for a repeated list line. */
function readSectionLines(section: readonly string[]): { patterns: string[]; lists: Map<string, string[]> } | string {
  const patterns: string[] = [];
  const lists = new Map<string, string[]>();
  for (const line of section) {
    const key = [PARSED, FUNCTIONS, CHECKS].find((prefix) => line.startsWith(prefix));
    if (key !== undefined) {
      if (lists.has(key)) return `a second "${key}" line`;
      lists.set(key, line.slice(key.length).trim().split(/\s+/).filter(Boolean));
    } else if (!line.startsWith("#")) {
      const pattern = line.trim().split(/\s+/)[0] as string;
      // Only anchored paths, with no wildcard but DEEP_NAME's: a file of one name at any depth below a folder (P1.20k,
      // every route's policy.ts). Their CODEOWNERS meaning is plain, so matching cannot under-match.
      if (!/^\/[^*?[\]!\\]+$/.test(pattern) && !DEEP_NAME.test(pattern)) {
        return `pattern ${pattern} is not an anchored path`;
      }
      patterns.push(pattern);
    }
  }
  return { patterns, lists };
}

/** Reads the `# trusted base (SE-6)` section: from its heading to the end of the file, with no blank line. */
export function readTrustedBase(codeowners: string): TrustedBaseRead {
  const lines = codeowners.split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
  const start = lines.indexOf(HEADING);
  if (start === -1) return { ok: false, error: `no "${HEADING}" section` };
  const section = lines.slice(start + 1);
  if (section.includes(HEADING)) return { ok: false, error: `a second "${HEADING}" line` };
  if (section.some((line) => line.trim() === "")) {
    return { ok: false, error: "a blank line inside the section (it must be the last section, with no blank line)" };
  }
  const read = readSectionLines(section);
  if (typeof read === "string") return { ok: false, error: read };
  const { patterns, lists } = read;
  const parsedPaths = lists.get(PARSED) ?? [];
  const trustedFunctions = lists.get(FUNCTIONS) ?? [];
  if (parsedPaths.length === 0) return { ok: false, error: `no "${PARSED}" paths` };
  if (trustedFunctions.length === 0) return { ok: false, error: `no "${FUNCTIONS}" names` };
  if (patterns.length === 0) return { ok: false, error: "no path patterns" };
  // A missing "# checks:" line reads as no paths: the base branch before P0.09c has none. The caller merges the base
  // and head sections and fails when the merged list is empty.
  const checks = lists.get(CHECKS) ?? [];
  if (checks.some((path) => !path.startsWith("/"))) return { ok: false, error: `a "${CHECKS}" path is not anchored` };
  return { ok: true, section: { patterns, parsedPaths, trustedFunctions, checks } };
}

// An anchored CODEOWNERS path: "/dir/" covers the folder; "/name" covers that file, or that folder's contents;
// "/dir/" + "**" + "/name" covers every file called name at any depth below dir, as GitHub reads it (docs.github.com,
// "About code owners", "CODEOWNERS syntax": a double star matches zero or more folders).
export function matchesPattern(path: string, pattern: string): boolean {
  const deep = DEEP_NAME.exec(pattern);
  if (deep !== null) {
    const [, folder = "", name = ""] = deep; // folder has no leading slash: "a/b/"
    return path.startsWith(folder) && (path === `${folder}${name}` || path.endsWith(`/${name}`));
  }
  const target = pattern.replace(/^\//, "");
  return target.endsWith("/") ? path.startsWith(target) : path === target || path.startsWith(`${target}/`);
}

/**
 * The changed paths on the trusted list: a path pattern, a `# parsed:` path (migrations, the grant matrix, the erasure
 * registry) or a `# checks:` path. No path rides free: a test, a fixture or a note under a listed path is listed too,
 * so the answer never depends on reading a file's content.
 */
export function trustedPathsChanged(changedPaths: readonly string[], base: TrustedBase): string[] {
  const listed = [...base.patterns, ...base.parsedPaths, ...base.checks];
  return changedPaths.filter((path) => listed.some((pattern) => matchesPattern(path, pattern)));
}

/** Both CODEOWNERS sections merged, base and head: a PR cannot leave a list by editing it. */
export function unionTrustedBase(base: TrustedBase, head: TrustedBase): TrustedBase {
  const union = (pick: (s: TrustedBase) => string[]) => [...new Set([...pick(base), ...pick(head)])];
  return {
    patterns: union((s) => s.patterns),
    parsedPaths: union((s) => s.parsedPaths),
    trustedFunctions: union((s) => s.trustedFunctions),
    checks: union((s) => s.checks),
  };
}
