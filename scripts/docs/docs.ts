// Checks over the repository's own documents (P0.09): the agent entry point, the ADR set, the PR
// template, the book snapshot and the architecture rule table. Each returns readable problems; [] is clean.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The step book says 80; the architecture thread set 120 for the five guideline imports (2026-10-04).
export const CLAUDE_MD_MAX_LINES = 120;
export const TOP15_IMPORT = "@docs/human/engineering/engineering-rules-top-15.md";
const TOP15_MAX_LINES = 25;
/** The five files CLAUDE.md imports: the four guideline documents and the rules' Top 15 page (architecture ruling). */
export const CLAUDE_MD_IMPORTS = [
  "@docs/human/engineering/architecture-instructions.md",
  "@docs/human/engineering/engineering-practices-addendum.md",
  "@docs/human/engineering/engineering-workflow-and-change-management.md",
  "@docs/human/engineering/architecture-and-development-guideline.md",
  TOP15_IMPORT,
];
export const AI_NOTES_LINE = "AI notes: updated / none needed / which";
const DECISIONS = "docs/human/decisions";
const ADR_HEADINGS = ["Context", "Decision", "Alternatives", "Consequences", "Compliance"];
export const ENTRYPOINTS = ["web", "api", "indexer", "media", "review", "admin", "pds-admin", "chat-admin"];
export const PR_TEMPLATE_HEADINGS = [
  "Step",
  "What",
  "Why",
  "How to test",
  "Security review",
  "Ownership path",
  "Threats",
  "ASVS rows",
  "Red evidence",
  "Behaviour change",
  "Performance evidence",
  "Migration or rollback",
  "Why this works (source read)",
  "Needs an ADR?",
  "Branch age",
  "What I am unsure about",
];
/** Words from the superseded v2e direction or an icon package; only the two bullets below may use them. */
const V2E_WORDS = /v2e|amber|chamfer|serif|\bUiIcon\b|iconoir-react/i;
const V2E_SUPERSEDED =
  '- The 0x40 "v2e" visual direction (vault note `v2e-visual-direction-locked`) is **superseded** by the design sheet; follow nothing from it.';
const ICONOIR_LINE =
  "- **Icons: Iconoir 7.12.1** (decision 33), scoped to the design sheet's Icon list and rendered by the `shared/ui` `Icon` component from the copied, pinned SVG data. No icon npm package (`iconoir-react` or any other), nothing fetched at runtime, never emoji or one-off SVG.";

const readText = (root: string, file: string): string => readFileSync(join(root, file), "utf8");

/** The text from a `## heading` up to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.search(new RegExp(`^## ${heading}\\b.*$`, "m"));
  if (start < 0) return "";
  const rest = text.slice(start + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** CLAUDE.md: short, pointing at the plan, the book and the engineering rules, with the rules' precedence and Delivery. */
export function claudeMdProblems(text: string): string[] {
  const found: string[] = [];
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (lines > CLAUDE_MD_MAX_LINES) found.push(`CLAUDE.md has ${lines} lines (max ${CLAUDE_MD_MAX_LINES})`);
  for (const link of ["docs/ai/book/", "docs/ai/PLAN.md", "docs/human/engineering/", "engineering-rules.md"]) {
    if (!text.includes(link)) found.push(`CLAUDE.md does not name ${link}`);
  }
  if (!text.split("\n").some((l) => l.trim() === TOP15_IMPORT))
    found.push(`CLAUDE.md lacks the import ${TOP15_IMPORT}`);
  const flat = text.replace(/\s+/g, " ");
  if (!/the plan wins/.test(flat) || !/architecture guideline wins/.test(flat)) {
    found.push("CLAUDE.md does not state the precedence rule (plan wins; architecture guideline wins on structure)");
  }
  return [...found, ...deliveryProblems(text), ...uiProblems(text)];
}

/** Delivery names D1, D2, D3, D4 and D8, and says agents never merge or push to `main` (decisions 40, 41; ADR 0009). */
function deliveryProblems(text: string): string[] {
  const delivery = section(text, "Delivery");
  const flat = delivery.replace(/\s+/g, " ");
  const found = ["D1", "D2", "D3", "D4", "D8"]
    .filter((d) => !new RegExp(`\\b${d}\\b`).test(delivery))
    .map((d) => `Delivery does not mention ${d}`);
  if (!/never merge/.test(flat)) found.push("Delivery does not say agents never merge");
  if (!/never push to `main`/.test(flat)) found.push("Delivery does not say agents never push to `main`");
  if (!/ADR 0009/.test(flat)) found.push("Delivery does not name ADR 0009");
  return found;
}

/** CLAUDE.md imports exactly the five files, each of which exists, and never the full rules file. */
export function claudeMdImportProblems(root: string, text: string): string[] {
  const imports = text
    .split("\n")
    .filter((l) => l.startsWith("@"))
    .map((l) => l.trim());
  const found = imports.filter((i) => !existsSync(join(root, i.slice(1)))).map((i) => `import ${i} does not resolve`);
  if ([...imports].sort().join("|") !== [...CLAUDE_MD_IMPORTS].sort().join("|")) {
    found.push(`CLAUDE.md imports must be exactly: ${CLAUDE_MD_IMPORTS.join(", ")}`);
  }
  return found;
}

/** No v2e instruction survives, v2e is named superseded, and Iconoir is named the way decision 33 says. */
function uiProblems(text: string): string[] {
  // Bullets and paragraphs, each on one line, so a sentence is compared whole.
  const blocks = text.split(/\n(?=- |\n|#)/).map((b) => b.replace(/\s+/g, " ").trim());
  const found = blocks
    .filter((b) => V2E_WORDS.test(b) && b !== V2E_SUPERSEDED && b !== ICONOIR_LINE)
    .map((b) => `CLAUDE.md mentions v2e or an icon package outside the two allowed lines: ${b.slice(0, 80)}`);
  if (!blocks.includes(V2E_SUPERSEDED)) found.push("CLAUDE.md does not name v2e-visual-direction-locked as superseded");
  if (!blocks.includes(ICONOIR_LINE))
    found.push("CLAUDE.md lacks the Iconoir line (7.12.1, shared/ui Icon, no icon packages)");
  return found;
}

/** The imported Top 15 page is short and its rules equal the Top 15 section of the full rules file. */
export function top15Problems(root: string): string[] {
  const page = readText(root, TOP15_IMPORT.slice(1));
  const found: string[] = [];
  if (page.trimEnd().split("\n").length > TOP15_MAX_LINES) found.push(`Top 15 page is over ${TOP15_MAX_LINES} lines`);
  const rules = (text: string) => text.split("\n").filter((l) => /^\d+\. \*\*/.test(l));
  const full = section(readText(root, "docs/human/engineering/engineering-rules.md"), "Top 15");
  if (rules(page).join("\n") !== rules(full).join("\n") || rules(page).length !== 15) {
    found.push("Top 15 page rules differ from the Top 15 section of engineering-rules.md");
  }
  return found;
}

/** Every ADR file has an index row and every row a file; each ADR but 0001 has the DO-1 shape. */
export function adrProblems(root: string): string[] {
  const all = readdirSync(join(root, DECISIONS)).filter((f) => f !== "README.md");
  const files = all.filter((f) => /^\d{4}-.*\.md$/.test(f));
  const index = readText(root, `${DECISIONS}/README.md`);
  const links = [...index.matchAll(/^\| \[(\d{4})\]\(([^)]+)\)/gm)];
  const rows = links.map((m) => m[2] ?? "");
  const found = [
    ...all.filter((f) => !files.includes(f)).map((f) => `${f} is not named NNNN-title.md`),
    ...links.filter((m) => !m[2]?.startsWith(`${m[1]}-`)).map((m) => `ADR index row ${m[1]} links ${m[2]}`),
    ...files.filter((f) => !rows.includes(f)).map((f) => `${f} has no row in the ADR index`),
    ...rows.filter((r) => !files.includes(r)).map((r) => `ADR index row ${r} has no file`),
  ];
  for (const file of files.filter((f) => !f.startsWith("0001-"))) {
    const text = readText(root, `${DECISIONS}/${file}`);
    if (!/^Status: \S/m.test(text)) found.push(`${file} has no Status line`);
    for (const h of ADR_HEADINGS) if (!new RegExp(`^## ${h}\\s*$`, "m").test(text)) found.push(`${file} lacks ## ${h}`);
    const alternatives = section(text, "Alternatives")
      .split("\n")
      .filter((l) => /^- /.test(l));
    if (alternatives.length < 2) found.push(`${file} lists fewer than two alternatives`);
  }
  return found;
}

const statusLine = (text: string): string => /^Status\b.*$/im.exec(text)?.[0].replace(/[*_]/g, "") ?? "";
const isAccepted = (text: string): boolean => /^Status\W+accepted\b/i.test(statusLine(text));
const withoutStatus = (text: string): string => text.replace(/^Status\b.*$/im, "");

/**
 * One changed ADR against its base text: 0001 only grows at its end; an accepted one changes only its status line,
 * to exactly "Status: Superseded by NNNN." naming an ADR in `adrNumbers`.
 */
export function adrChangeProblem(
  file: string,
  before: string,
  after: string | null,
  adrNumbers: ReadonlySet<string>,
): string | null {
  if (file.startsWith("0001-")) {
    const whole = before.endsWith("\n") ? before : `${before}\n`;
    return after?.startsWith(whole) ? null : `${file}: ADR 0001 may only gain lines at its end`;
  }
  if (!isAccepted(before)) return null;
  if (after === null) return `${file}: an accepted ADR was deleted or renamed`;
  const by = /^Status: Superseded by (\d{4})\.?$/i.exec(statusLine(after))?.[1];
  return by && adrNumbers.has(by) && withoutStatus(after) === withoutStatus(before)
    ? null
    : `${file}: an accepted ADR may only change its status to "Superseded by NNNN" (an existing ADR)`;
}

/** Every ADR changed in the working tree since it left `base` (a git ref), checked with adrChangeProblem. */
export function adrImmutableProblems(root: string, base: string): string[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  // No rename detection: a renamed ADR shows as its old path deleted, which the check refuses.
  const changed = git("diff", "--no-renames", "--name-only", mergeBase, "--", DECISIONS).split("\n").filter(Boolean);
  const adrNumbers = new Set(readdirSync(join(root, DECISIONS)).map((f) => f.slice(0, 4)));
  const found: string[] = [];
  for (const path of changed) {
    const file = path.slice(DECISIONS.length + 1);
    if (!/^\d{4}-/.test(file)) continue;
    let before: string;
    try {
      before = git("show", `${mergeBase}:${path}`);
    } catch {
      continue; // A new ADR.
    }
    const after = existsSync(join(root, path)) ? readText(root, path) : null;
    const problem = adrChangeProblem(file, before, after, adrNumbers);
    if (problem) found.push(problem);
  }
  return found;
}

/** The PR template has the required headings, in order. */
export function prTemplateProblems(text: string): string[] {
  const afterLast = text.slice(text.indexOf("## What I am unsure about"));
  const notes = afterLast.split("\n").some((l) => l.trim() === AI_NOTES_LINE);
  return [...headingProblems(text), ...(notes ? [] : [`PR template lacks "${AI_NOTES_LINE}" after its headings`])];
}

function headingProblems(text: string): string[] {
  const headings = [...text.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
  const inOrder = headings.filter((h) => h !== undefined && PR_TEMPLATE_HEADINGS.includes(h));
  return inOrder.join("|") === PR_TEMPLATE_HEADINGS.join("|")
    ? []
    : [`PR template headings are not, in order: ${PR_TEMPLATE_HEADINGS.join(", ")}`];
}

type Row = { rule: string; checkedBy: string };

/** The rows of the "Architecture rules and how each is checked" table. */
export function architectureRows(text: string): Row[] {
  const table = section(text, "Architecture rules and how each is checked");
  return table
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l) && !/^\|\s*Rule\s*\|/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()))
    .map((cells) => ({ rule: cells[1] ?? "", checkedBy: cells[3] ?? "" }));
}

export type KnownChecks = { forbidden: Set<string>; tests: Set<string>; files: Set<string>; mergedSteps: Set<string> };

/** Rule AB-4: every checked row names checks that exist, every config rule has a row, review-only rows say why. */
export function architectureTableProblems(rows: Row[], known: KnownChecks): string[] {
  if (rows.length === 0) return ["the architecture rule table has no rows"];
  const named = new Set(rows.flatMap((r) => (r.checkedBy.startsWith("checked:") ? namedChecks(r.checkedBy) : [])));
  const found = rows.flatMap((r) => rowProblems(r, known));
  if (!named.has("MATRIX")) found.push("no row names MATRIX");
  for (const name of known.forbidden) if (!named.has(name)) found.push(`config rule ${name} has no row`);
  return found;
}

const namedChecks = (checkedBy: string): string[] => [...checkedBy.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");

/** One row: review-only with a reason, planned for a step that has not merged, or checked by checks that exist. */
function rowProblems({ rule, checkedBy }: Row, known: KnownChecks): string[] {
  const review = /^review-only:\s*(.*)$/.exec(checkedBy);
  if (review) return review[1]?.trim() ? [] : [`${rule}: review-only without a reason`];
  const planned = /^planned: (P\d+\.\d+[a-z]?)$/.exec(checkedBy)?.[1];
  if (planned)
    return known.mergedSteps.has(planned) ? [`${rule}: ${planned} has merged but the row still says planned`] : [];
  if (!checkedBy.startsWith("checked:")) return [`${rule}: "Checked by" is neither checked, planned nor review-only`];
  const checks = namedChecks(checkedBy);
  if (checks.length === 0) return [`${rule}: checked row names no check`];
  const exists = (c: string) => c === "MATRIX" || known.forbidden.has(c) || known.tests.has(c) || known.files.has(c);
  return checks.filter((c) => !exists(c)).map((c) => `${rule}: names \`${c}\`, which does not exist`);
}

/** Every Vitest test name declared under `dirs`, read from the source text. */
export function testNames(root: string, dirs: string[]): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== "fixtures" && entry.name !== "node_modules") walk(path);
      else if (entry.name.endsWith(".test.ts")) {
        const code = readText(root, path).replace(/^\s*\/\/.*$/gm, "");
        for (const m of code.matchAll(/\btest(?:\.each\([^)]*\))?\(\s*"([^"%]+)/g)) {
          names.add((m[1] ?? "").trim());
        }
      }
    }
  };
  for (const dir of dirs) if (existsSync(join(root, dir))) walk(dir);
  return names;
}

/** SECURITY.md names every entrypoint. */
export function securityMdProblems(text: string): string[] {
  return ENTRYPOINTS.filter((e) => !new RegExp(`\`${e}\``).test(text)).map((e) => `SECURITY.md does not name \`${e}\``);
}

/** The book snapshot names the folder, planning round and date it copies. */
export function bookSnapshotProblems(text: string): string[] {
  const found: string[] = [];
  if (!/\bround\s+(\d+|"[^"\n]+")/i.test(text)) found.push("docs/ai/book/README.md names no round");
  if (!/\b\d{4}-\d{2}-\d{2}\b/.test(text)) found.push("docs/ai/book/README.md names no date");
  if (!text.includes("unset-plan/breakdown/")) found.push("docs/ai/book/README.md does not name its source folder");
  return found;
}

/** One canonical glossary: a section heading, one unique bold word per row; the book keeps a short pointer. */
export function glossaryProblems(glossary: string, pointer: string): string[] {
  const found: string[] = [];
  const rows = glossary.split("\n").filter((l) => l.startsWith("|") && !/^\|\s*(-|Word\s*\|)/.test(l));
  const words = rows.map((l) => /^\| \*\*(.+?)\*\* \|/.exec(l)?.[1]);
  if (!/^## /m.test(glossary) || rows.length === 0) found.push("docs/human/glossary.md has no sections or words");
  for (const [i, w] of words.entries()) if (!w) found.push(`glossary row is not a bold word: ${rows[i]}`);
  const seen = new Set<string>();
  for (const w of words) {
    if (w && seen.has(w.toLowerCase())) found.push(`glossary word ${w} appears twice`);
    if (w) seen.add(w.toLowerCase());
  }
  const lines = pointer.trimEnd().split("\n");
  if (lines.length > 3 || !pointer.includes("docs/human/glossary.md")) {
    found.push("docs/ai/book/03-glossary.md is not a pointer of at most three lines naming docs/human/glossary.md");
  }
  return found;
}
