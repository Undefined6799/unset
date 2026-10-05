// P0.09d: the AI notes guard. Enforces docs/ai/README.md "Keeping it maintained": header schema, links, the generated
// INDEX.md, code moved without its note, and handoff age. The header parser is in notes-header.ts.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Finding, filesUnder, read } from "./files.ts";
import { fieldReader, linkTarget, readHeader } from "./notes-header.ts";

export const VAULT = "docs/ai";
export const TYPES = ["area", "reference", "pitfall", "how-to", "handoff"] as const;
const STATUSES = ["current", "replaced"];
const IMPORTANCE = ["high", "normal"];
export const AREAS = [
  ...["web", "admin", "chat", "http", "api", "indexer", "media", "review", "pds-admin", "chat-admin"],
  ...["identity", "content", "social", "feed", "messaging", "moderation", "privacy"],
  ...["postgres", "pds", "tap", "matrix", "storage", "arachnid", "email", "net-guard", "seal", "audit"],
  ...["lexicons", "ui", "config", "errors", "i18n", "deployment", "tests", "ci", "docs"],
];
const FIELDS = [
  ...["id", "type", "status", "areas", "summary", "code", "sources"],
  ...["importance", "related", "replaced_by", "tags", "checked"],
];
const SUMMARY_MAX = 120;
const HANDOFF_DAYS = 14;
const STALE_DAYS = 90;
/** Decision-34 parents an area folder can sit under; `deployment` and `tests` are top-level folders themselves. */
const AREA_PARENTS = ["apps", "interfaces", "domains", "infrastructure", "shared"];

export type Note = {
  path: string;
  id: string;
  type: string;
  status: string;
  areas: string[];
  summary: string;
  code: string[];
  importance: string;
  related: string[];
  replacedBy: string | null;
  checked: string;
  line: Record<string, number>;
};
/** Parses one note and applies the per-note rules `[notes-header]`, `[notes-id]`, `[notes-summary]`, `[notes-tags]`. */
export function parseNote(path: string, text: string): Note | Finding[] {
  const header = readHeader(path, text, FIELDS);
  if (Array.isArray(header)) return header;
  const found: Finding[] = [];
  const fail = (rule: string, key: string, msg: string) =>
    found.push({ file: path, line: header.line[key] ?? 1, rule, text: msg });
  const field = fieldReader(header, (key, msg) => fail("notes-header", key, msg));
  const replacedRaw = header.fields.get("replaced_by");
  const note: Note = {
    path,
    id: field.str("id"),
    type: field.oneOf("type", TYPES),
    status: field.oneOf("status", STATUSES),
    areas: [],
    summary: field.str("summary"),
    code: field.list("code").filter((c) => {
      const plain = /^[\w.-]+(\/[\w.-]+)*$/.test(c) && !c.split("/").some((part) => part === "." || part === "..");
      if (!plain) fail("notes-header", "code", `code path ${c} must be a plain repo-relative path, no ./, .. or //`);
      return plain;
    }),
    importance: field.oneOf("importance", IMPORTANCE),
    related: field.links("related"),
    replacedBy: typeof replacedRaw === "string" ? linkTarget(replacedRaw) : null,
    checked: field.date("checked"),
    line: header.line,
  };
  field.list("sources");
  const before = found.length;
  for (const area of field.links("areas")) {
    if (AREAS.includes(area)) note.areas.push(area);
    else fail("notes-header", "areas", `area ${area} is not listed`);
  }
  if (header.fields.get("areas")?.length === 0) fail("notes-header", "areas", "areas is empty");
  const areasOk = found.length === before; // A bad `areas` is reported once, not again as a tags mismatch.
  if (replacedRaw !== null && !note.replacedBy)
    fail("notes-header", "replaced_by", 'replaced_by must be null or "[[note-id]]"');
  if (note.status && (note.status === "replaced") !== (replacedRaw !== null)) {
    fail("notes-header", "status", "status replaced needs replaced_by, and only then");
  }
  found.push(...placementProblems(note, field.list("tags"), areasOk));
  return found.length ? found : note;
}

/** `[notes-id]`, `[notes-summary]` and `[notes-tags]`: the rules that compare fields with the file and each other. */
function placementProblems(note: Note, tags: readonly string[], areasOk: boolean): Finding[] {
  const found: Finding[] = [];
  const fail = (rule: string, key: string, text: string) =>
    found.push({ file: note.path, line: note.line[key] ?? 1, rule, text });
  if (note.id !== basename(note.path, ".md")) fail("notes-id", "id", `id ${note.id} does not match the file name`);
  if (note.type && dirname(note.path) !== `${VAULT}/notes/${note.type}`) {
    fail("notes-id", "type", `a ${note.type} note must sit in notes/${note.type}/`);
  }
  if (note.summary.trim().length === 0 || note.summary.length > SUMMARY_MAX) {
    fail("notes-summary", "summary", `summary has ${note.summary.length} characters (1 to ${SUMMARY_MAX})`);
  }
  const want = [note.type, ...note.areas];
  const exact =
    tags.length === want.length && new Set(tags).size === tags.length && want.every((t) => tags.includes(t));
  if (note.type && areasOk && !exact) fail("notes-tags", "tags", `tags must be exactly ${want.join(", ")}`);
  return found;
}

/** The parsed notes, every per-note finding, and how many note files were scanned (AB-4). */
export function loadNotes(root: string): { notes: Note[]; findings: Finding[]; scanned: number } {
  const notes: Note[] = [];
  const findings: Finding[] = [];
  const files = filesUnder(root, [`${VAULT}/notes`], /./);
  for (const path of files.filter((f) => !f.endsWith(".md") && basename(f) !== ".gitkeep")) {
    findings.push({ file: path, line: 1, rule: "notes-id", text: "only <id>.md notes and .gitkeep go under notes/" });
  }
  const paths = files.filter((f) => f.endsWith(".md"));
  for (const path of paths) {
    const parsed = parseNote(path, read(root, path));
    if (Array.isArray(parsed)) findings.push(...parsed);
    else notes.push(parsed);
  }
  return { notes, findings, scanned: paths.length };
}

const cell = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll("|", "\\|");

/** INDEX.md for these notes, sorted by id. Paths are relative to docs/ai so GitHub and agents can click through. */
export function buildIndex(notes: readonly Note[]): string {
  const rows = [...notes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => {
      const star = n.importance === "high" ? " ★" : "";
      const link = `[${n.id}](${n.path.slice(VAULT.length + 1)})`;
      return `| ${link} | ${n.type}${star} | ${n.areas.join(", ")} | ${cell(n.summary)} |`;
    });
  return [
    "# AI notes index",
    "",
    "Generated by `npm run notes:index` and checked by `npm run guards`. Do not edit by hand.",
    "",
    "| id | type | areas | summary |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "★ = importance: high, read before touching these areas.",
    "",
  ].join("\n");
}

const daysBefore = (today: Date, date: string): number =>
  Math.floor((today.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);

/** Rules 2 and 5 for one note: dead links and an old handoff. */
function noteProblems(root: string, note: Note, ids: ReadonlySet<string>, today: Date): Finding[] {
  const found: Finding[] = [];
  const fail = (rule: string, key: string, text: string) =>
    found.push({ file: note.path, line: note.line[key] ?? 1, rule, text });
  for (const target of note.related)
    if (!ids.has(target)) fail("notes-link", "related", `related [[${target}]] names no note`);
  if (note.replacedBy && !ids.has(note.replacedBy)) {
    fail("notes-link", "replaced_by", `replaced_by [[${note.replacedBy}]] names no note`);
  }
  for (const path of note.code) {
    if (!existsSync(join(root, path))) fail("notes-link", "code", `code path ${path} does not exist`);
  }
  // A future date would switch the age rules off for good.
  if (daysBefore(today, note.checked) < 0) fail("notes-header", "checked", `checked ${note.checked} is after today`);
  if (note.type === "handoff" && daysBefore(today, note.checked) > HANDOFF_DAYS) {
    fail("notes-handoff-age", "checked", `handoff checked ${note.checked}, more than ${HANDOFF_DAYS} days ago`);
  }
  return found;
}

/** Rule 4: every changed file named in a note's `code:` (a file, or a folder it sits in) needs that note changed too. */
function codeMovedProblems(notes: readonly Note[], changed: readonly string[]): Finding[] {
  const found: Finding[] = [];
  const touched = new Set(changed);
  for (const note of notes) {
    if (touched.has(note.path)) continue;
    const hit = changed.find((file) =>
      note.code.some((c) => file === c || file.startsWith(`${c.replace(/\/$/, "")}/`)),
    );
    if (hit) {
      const text = `${hit} changed but this note did not; update it or bump checked`;
      found.push({ file: note.path, line: note.line.code ?? 1, rule: "notes-code-moved", text });
    }
  }
  return found;
}

function warningsFor(root: string, notes: readonly Note[], today: Date): Finding[] {
  const found: Finding[] = [];
  for (const n of notes) {
    if (n.status === "current" && daysBefore(today, n.checked) > STALE_DAYS) {
      const text = `checked ${n.checked}, more than ${STALE_DAYS} days ago; re-check it`;
      found.push({ file: n.path, line: n.line.checked ?? 1, rule: "notes-stale", text });
    }
  }
  const hubs = new Set(notes.filter((n) => n.type === "area").map((n) => n.id));
  for (const area of AREAS) {
    const folders = [
      ...AREA_PARENTS.map((p) => `${p}/${area}`),
      ...(["deployment", "tests"].includes(area) ? [area] : []),
    ];
    const folder = folders.find((f) => existsSync(join(root, f)));
    if (folder && !hubs.has(area)) {
      found.push({ file: folder, line: 1, rule: "notes-hub", text: `no hub note ${VAULT}/notes/area/${area}.md` });
    }
  }
  return found;
}

export type CheckOptions = { changedPaths?: readonly string[] | undefined; today: Date };

/** Every rule over the vault under `root`. `scanned` is the number of note files seen (AB-4). */
export function checkNotes(
  root: string,
  opts: CheckOptions,
): { errors: Finding[]; warnings: Finding[]; scanned: number } {
  const { notes, findings, scanned } = loadNotes(root);
  const errors = [...findings];
  const byId = new Map<string, Note>();
  for (const note of notes) {
    const other = byId.get(note.id);
    if (other) errors.push({ file: note.path, line: 1, rule: "notes-id", text: `id ${note.id} is also ${other.path}` });
    byId.set(note.id, note);
  }
  // A note whose header fails still exists, under its file name and its declared id, so links to it are not dead too.
  const failed = [...new Set(findings.map((f) => f.file))];
  const headerOf = (file: string) => read(root, file).split(/^---\r?$/m)[1] ?? "";
  const declared = failed.map((file) => /^id: "?([^"\s]+)"?\r?$/m.exec(headerOf(file))?.[1] ?? "");
  const ids = new Set([...byId.keys(), ...failed.map((file) => basename(file, ".md")), ...declared]);
  for (const note of notes) errors.push(...noteProblems(root, note, ids, opts.today));
  // A note whose header does not parse is missing from the rebuilt index; report the header, not a second finding.
  const indexPath = `${VAULT}/INDEX.md`;
  const committed = existsSync(join(root, indexPath)) ? read(root, indexPath) : "";
  if (findings.length === 0 && committed !== buildIndex(notes)) {
    errors.push({ file: indexPath, line: 1, rule: "notes-index", text: "out of date; run npm run notes:index" });
  }
  if (opts.changedPaths) errors.push(...codeMovedProblems(notes, opts.changedPaths));
  return { errors, warnings: warningsFor(root, notes, opts.today), scanned };
}

const git = (root: string, args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const lines = (text: string): string[] => text.split("\n").filter(Boolean);

/**
 * The files this change touches. In CI: `BASE_SHA...HEAD`, and no base is an error (fail closed). Locally: the
 * working tree and untracked files against the merge-base with origin/main, a superset of what pre-commit stages;
 * if git cannot answer locally (no origin/main, not a clone) the rule is skipped and a warning says so; CI then
 * enforces it. `--no-renames` lists both sides of a move, so moving a file out of a named folder counts.
 */
export function changedPaths(root: string, env: NodeJS.ProcessEnv): { paths?: string[]; problem?: Finding } {
  const at = (rule: string, text: string): Finding => ({ file: VAULT, line: 1, rule, text });
  if (env.CI) {
    const base = env.BASE_SHA ?? "";
    if (!/^[0-9a-f]{40}$/.test(base) || /^0+$/.test(base)) {
      return { problem: at("notes-code-moved", "CI gave no BASE_SHA to compare against") };
    }
    try {
      return { paths: lines(git(root, ["diff", "--name-only", "--no-renames", `${base}...HEAD`])) };
    } catch {
      return { problem: at("notes-code-moved", `cannot diff against BASE_SHA ${base}`) };
    }
  }
  try {
    const base = git(root, ["merge-base", "HEAD", "origin/main"]).trim();
    const changed = lines(git(root, ["diff", "--name-only", "--no-renames", base]));
    return { paths: [...changed, ...lines(git(root, ["ls-files", "--others", "--exclude-standard"]))] };
  } catch {
    return { problem: at("notes-base", "no origin/main to compare against; code-moved rule skipped") };
  }
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "..");
  const { notes, findings } = loadNotes(root);
  if (findings.length) {
    process.stderr.write(`${findings.map((f) => `${f.file}:${f.line}  [${f.rule}]  ${f.text}`).join("\n")}\n`);
    process.exitCode = 1;
  } else writeFileSync(join(root, VAULT, "INDEX.md"), buildIndex(notes));
}
