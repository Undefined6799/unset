// Endpoint pages for the Hugo docs (P0.09, issue #1161 section 3).
//
// Generated columns come from web route files, their policy.ts exports and lib/server/limits.ts.
// Only policy modules are imported; handlers are parsed without executing their dependencies.
// Optional prose comes from docs/site/data/endpoints/web.yaml.
// A security fact those files do not state is the cell "not recorded".
//
// YAML is yaml 2.9.1 (node_modules/yaml/package.json). parseDocument uses the YAML 1.2 core schema,
// which is the library default (https://eemeli.org/yaml/#options, read 2026-10-21), with uniqueKeys and
// stringKeys (node_modules/yaml/dist/options.d.ts). toJS sets maxAliasCount to 0, which disallows aliases
// (same file, ToJSOptions.maxAliasCount). Sidebar order is front-matter weight, as Hextra v0.13.0 documents
// at https://imfing.github.io/hextra/docs/guide/organize-files/ (read 2026-10-21).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSync } from "vite";
import { parseDocument } from "yaml";

export const NOT_RECORDED = "not recorded";

const CONTENT_DIR = "docs/site/content/endpoints";
const DATA_DIR = "docs/site/data/endpoints";
const ROUTES = "interfaces/web/src/routes";
const LIMITS = "interfaces/web/src/lib/server/limits.ts";
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const KNOWN_FIELDS = new Set([
  "group",
  "client",
  "limit",
  "writeLimit",
  "session",
  "returnTo",
  "maxBody",
  "deadlineMs",
  "bodyWindowMs",
  "probe",
  "testOnly",
]);
const NOTE_FIELDS = new Set(["why", "input", "output", "errors", "auth"]);
const PROSE_FIELDS = ["why", "input", "output", "errors", "auth"] as const;
const PROSE = /^[^\n|]{0,500}$/;
const SCOPES = new Set(["ip", "did", "global"]);
export type Bucket = { readonly scope: string; readonly capacity: number; readonly refillPerSec: number };

export type RouteRecord = {
  readonly method: string;
  readonly path: string;
  readonly group: string | null;
  /** A route whose own page does not run SvelteKit's client (policy.ts `client`, ADR 0116 point 4); a policy says it
   * only as `false`. */
  readonly client: false | null;
  readonly session: string | null;
  readonly rateLimit: string | null;
  readonly writeLimit: string | null;
  readonly bodyLimit: number | null;
  readonly deadlineMs: number | null;
  readonly bodyWindowMs: number | null;
  readonly testOnly: boolean | null;
  readonly probe: boolean | null;
  readonly why: string;
  readonly input: string;
  readonly output: string;
  readonly errors: string;
  readonly auth: string;
};

type HandNote = Pick<RouteRecord, "why" | "input" | "output" | "errors" | "auth">;
type Draft = Omit<RouteRecord, "why" | "input" | "output" | "errors" | "auth">;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type ProcessModel = {
  readonly name: string;
  readonly routes: readonly RouteRecord[];
  readonly policies: ReadonlyMap<string, readonly Bucket[]> | null;
};

export type EndpointModel = { readonly processes: readonly ProcessModel[] };
export type LoadResult =
  | { readonly ok: true; readonly model: EndpointModel }
  | { readonly ok: false; readonly problems: readonly string[] };

const EMPTY_NOTE: HandNote = Object.fromEntries(PROSE_FIELDS.map((field) => [field, NOT_RECORDED])) as HandNote;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const formatNum = (n: number): string => (Object.is(n, -0) ? "0" : String(n));
const routeKey = (method: string, path: string): string => `${method} ${path}`;
function problemLine(error: unknown): string {
  const message = error instanceof Error ? error.message : "unreadable";
  return message.replaceAll("\n", " ").slice(0, 200);
}

function readField<T>(
  owner: Record<string, unknown>,
  field: string,
  at: string,
  problems: string[],
  ok: (value: unknown) => T | undefined,
  complaint: string,
): T | null {
  if (!Object.hasOwn(owner, field)) return null;
  const parsed = ok(owner[field]);
  if (parsed !== undefined) return parsed;
  problems.push(`${at} ${complaint}`);
  return null;
}

const oneLine = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" && !/[\n`|]/.test(value) ? value : undefined;
const flag = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);
const onlyFalse = (value: unknown): false | undefined => (value === false ? false : undefined);
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
function readDraft(
  file: string,
  value: unknown,
  method: string,
  path: string,
): { draft: Draft | null; problems: string[] } {
  const problems: string[] = [];
  if (!isPlainObject(value)) return { draft: null, problems: [`${file}: no policy object exported`] };
  if (oneLine(path) === undefined)
    return { draft: null, problems: [`${file}: route id cannot be rendered as a table cell`] };
  for (const field of Object.keys(value)) {
    if (!KNOWN_FIELDS.has(field)) problems.push(`${file}: unknown field ${field}`);
  }
  return {
    draft: {
      method,
      path,
      group: readField(value, "group", file, problems, oneLine, "group is not a single-line string"),
      client: readField(value, "client", file, problems, onlyFalse, "client is not false"),
      rateLimit: readField(value, "limit", file, problems, oneLine, "limit is not a single-line string"),
      writeLimit: readField(value, "writeLimit", file, problems, oneLine, "writeLimit is not a single-line string"),
      session: readField(value, "session", file, problems, oneLine, "session is not a single-line string"),
      bodyLimit: readField(value, "maxBody", file, problems, count, "maxBody is not a positive integer"),
      deadlineMs: readField(value, "deadlineMs", file, problems, count, "deadlineMs is not a positive integer"),
      bodyWindowMs: readField(value, "bodyWindowMs", file, problems, count, "bodyWindowMs is not a positive integer"),
      testOnly: readField(value, "testOnly", file, problems, flag, "testOnly is not a boolean"),
      probe: readField(value, "probe", file, problems, flag, "probe is not a boolean"),
    },
    problems,
  };
}

/** Vite 8.3.5 re-exports parseSync (dist/node/index.d.ts); rolldown 1.2.15's StaticExportEntry
 * records exportName and isType. Parse syntax, never comments or handler dependencies. */
function exportedNames(file: string): Set<string> {
  const parsed = parseSync(file, readFileSync(file, "utf8"), { lang: "ts", sourceType: "module" });
  if (parsed.errors.length > 0) throw new Error(`cannot parse exports: ${parsed.errors[0]?.message}`);
  const names = new Set<string>();
  for (const entry of parsed.module.staticExports.flatMap((item) => item.entries)) {
    if (entry.isType) continue;
    if (entry.exportName.name === null) throw new Error("export * needs explicit names for endpoint documentation");
    names.add(entry.exportName.name);
  }
  return names;
}

/** SvelteKit 3.2.0 src/core/sync/create_manifest_data/index.js recognises +page/+server files;
 * src/runtime/server/page/actions.js dispatches actions on POST; endpoint.js dispatches named methods.
 * These are declared methods, not an execution trace (no implicit HEAD/OPTIONS or handler success claim). */
function routeMethods(root: string, folder: string, files: readonly string[]): string {
  const methods = new Set<string>();
  if (files.some((file) => /^\+page(?:\.server)?\.(?:svelte|ts|js)$/.test(file))) methods.add("GET");
  for (const file of files.filter((file) => /^\+(?:server|page\.server)\.[tj]s$/.test(file))) {
    const names = exportedNames(join(root, folder, file));
    if (file.startsWith("+server")) {
      for (const method of METHODS.filter((method) => names.has(method))) methods.add(method);
      if (names.has("fallback")) throw new Error("fallback handler needs explicit methods for endpoint documentation");
    } else if (names.has("actions")) methods.add("POST");
  }
  return METHODS.filter((method) => methods.has(method)).join(", ") || NOT_RECORDED;
}

async function readRoutes(root: string): Promise<{ drafts: Draft[]; problems: string[] }> {
  const drafts: Draft[] = [];
  const problems: string[] = [];
  const entries = existsSync(join(root, ROUTES))
    ? readdirSync(join(root, ROUTES), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    : [];
  const folders = [...new Set(entries.map((entry) => entry.parentPath))].sort();
  for (const folder of folders) {
    const files = entries.filter((entry) => entry.parentPath === folder).map((entry) => entry.name);
    const file = `${relative(root, folder)}/policy.ts`;
    const isRoute = files.some((name) => /^\+(?:server|page(?:\.server)?)\.(?:svelte|ts|js)$/.test(name));
    if (isRoute && !files.includes("policy.ts")) problems.push(`${file}: missing`);
    if (!files.includes("policy.ts")) continue;
    try {
      const imported: unknown = await import(pathToFileURL(join(root, file)).href);
      const path = `/${relative(join(root, ROUTES), folder)}`;
      const read = readDraft(
        file,
        isPlainObject(imported) ? imported.policy : undefined,
        routeMethods(root, relative(root, folder), files),
        path,
      );
      problems.push(...read.problems);
      if (read.draft !== null) drafts.push(read.draft);
    } catch (error) {
      problems.push(`${file}: ${problemLine(error)}`);
    }
  }
  if (drafts.length === 0) problems.push(`${ROUTES}: no route policies found`);
  return { drafts, problems };
}

function readNote(file: string, key: string, value: unknown): { note: HandNote; problems: string[] } {
  if (!isPlainObject(value)) return { note: EMPTY_NOTE, problems: [`${file}: "${key}" is not a mapping`] };
  const problems: string[] = [];
  for (const field of Object.keys(value)) {
    if (!NOTE_FIELDS.has(field)) problems.push(`${file}: "${key}" has unknown field ${field}`);
  }
  const note: Mutable<HandNote> = { ...EMPTY_NOTE };
  for (const field of PROSE_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const text = value[field];
    if (typeof text !== "string" || !PROSE.test(text)) {
      problems.push(`${file}: "${key}" ${field} must be one line without a pipe`);
    } else note[field] = text || NOT_RECORDED;
  }
  return { note, problems };
}

function readNotes(root: string, name: string): { notes: Map<string, HandNote>; problems: string[] } {
  const file = `${DATA_DIR}/${name}.yaml`;
  const abs = join(root, file);
  if (!existsSync(abs)) return { notes: new Map(), problems: [] };
  let parsed: unknown;
  try {
    const doc = parseDocument(readFileSync(abs, "utf8"), {
      schema: "core",
      uniqueKeys: true,
      stringKeys: true,
      strict: true,
    });
    if (doc.errors.length > 0)
      return { notes: new Map(), problems: doc.errors.map((error) => `${file}: ${problemLine(error)}`) };
    parsed = doc.toJS({ maxAliasCount: 0 }) ?? {};
  } catch (error) {
    return { notes: new Map(), problems: [`${file}: ${problemLine(error)}`] };
  }
  if (!isPlainObject(parsed))
    return { notes: new Map(), problems: [`${file}: expected a mapping of "METHOD[, METHOD] route id"`] };
  const notes = new Map<string, HandNote>();
  const problems: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[A-Z]+(?:, [A-Z]+)* \/\S*$/.test(key)) problems.push(`${file}: bad key "${key}"`);
    const read = readNote(file, key, value);
    problems.push(...read.problems);
    notes.set(key, read.note);
  }
  return { notes, problems };
}

function isBucket(value: unknown): value is Bucket {
  if (!isPlainObject(value)) return false;
  const { capacity, refillPerSec, scope } = value;
  return (
    typeof capacity === "number" &&
    Number.isInteger(capacity) &&
    capacity >= 1 &&
    typeof refillPerSec === "number" &&
    Number.isFinite(refillPerSec) &&
    refillPerSec > 0 &&
    typeof scope === "string" &&
    SCOPES.has(scope)
  );
}

async function readPolicies(
  root: string,
): Promise<{ policies: ReadonlyMap<string, readonly Bucket[]> | null; problems: string[] }> {
  const file = LIMITS;
  if (!existsSync(join(root, file))) return { policies: null, problems: [] };
  let imported: unknown;
  try {
    imported = await import(pathToFileURL(join(root, file)).href);
  } catch (error) {
    return { policies: null, problems: [`${file}: ${problemLine(error)}`] };
  }
  if (!isPlainObject(imported) || !Object.hasOwn(imported, "policies")) {
    return { policies: null, problems: [`${file}: no policies export`] };
  }
  if (!isPlainObject(imported.policies))
    return { policies: null, problems: [`${file}: policies is not a plain object`] };
  const policies = new Map<string, readonly Bucket[]>();
  const problems: string[] = [];
  for (const [policy, entries] of Object.entries(imported.policies)) {
    if (!Array.isArray(entries) || entries.length === 0 || !entries.every(isBucket)) {
      problems.push(`${file}: policy "${policy}" has an entry the generator cannot read`);
      continue;
    }
    policies.set(
      policy,
      entries.map((entry) => ({ scope: entry.scope, capacity: entry.capacity, refillPerSec: entry.refillPerSec })),
    );
  }
  return { policies, problems };
}

function policyProblems(draft: Draft, policies: ProcessModel["policies"]): string[] {
  const key = routeKey(draft.method, draft.path);
  return [draft.rateLimit, draft.writeLimit].flatMap((name) => {
    if (name === null) return [];
    if (policies === null) return [`${LIMITS}: ${key} names "${name}" but the file does not exist`];
    return policies.has(name) ? [] : [`${LIMITS}: ${key} names "${name}" but no such policy is exported`];
  });
}

/** A data-file key with no route. A key that already failed the key pattern is not also an orphan. */
function orphanProblems(file: string, notes: ReadonlyMap<string, HandNote>, seen: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const key of notes.keys()) {
    if (seen.has(key)) continue;
    if (!/^[A-Z]+(?:, [A-Z]+)* \/\S*$/.test(key)) continue;
    problems.push(`${file}: orphan key "${key}"`);
  }
  return problems;
}

function assemble(
  name: string,
  drafts: readonly Draft[],
  notes: ReadonlyMap<string, HandNote>,
  policies: ReadonlyMap<string, readonly Bucket[]> | null,
): { process: ProcessModel; problems: string[] } {
  const file = `${DATA_DIR}/${name}.yaml`;
  const problems: string[] = [];
  const routes: RouteRecord[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = routeKey(draft.method, draft.path);
    seen.add(key);
    const noted = notes.get(key);
    problems.push(...policyProblems(draft, policies));
    routes.push({ ...draft, ...(noted ?? EMPTY_NOTE) });
  }
  return { process: { name, routes, policies }, problems: [...problems, ...orphanProblems(file, notes, seen)] };
}

/** The pages the committed tree must match, or the problems that stop a write. */
export async function loadEndpointModel(root: string): Promise<LoadResult> {
  const routes = await readRoutes(root);
  const notes = readNotes(root, "web");
  const policies = await readPolicies(root);
  const built = assemble("web", routes.drafts, notes.notes, policies.policies);
  const problems = [...routes.problems, ...notes.problems, ...policies.problems, ...built.problems];
  const processes = [built.process];
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)].sort() };
  return { ok: true, model: { processes } };
}

const bucketText = (buckets: readonly Bucket[]): string =>
  buckets
    .map(
      (bucket) =>
        `${bucket.scope}: capacity ${formatNum(bucket.capacity)}, refillPerSec ${formatNum(bucket.refillPerSec)}`,
    )
    .join("; ");

function bucketCell(name: string | null, policies: ProcessModel["policies"]): string {
  if (name === null || policies === null) return NOT_RECORDED;
  const buckets = policies.get(name);
  return buckets === undefined ? NOT_RECORDED : bucketText(buckets);
}

const yn = (value: boolean | null): string => (value === null ? NOT_RECORDED : value ? "yes" : "no");

/** The deadline, and for a route with a body window the time its body may take before the deadline starts. */
function deadlineCell(route: RouteRecord): string {
  if (route.deadlineMs === null) return NOT_RECORDED;
  if (route.bodyWindowMs === null) return String(route.deadlineMs);
  return `${route.deadlineMs} after a ${route.bodyWindowMs} body window`;
}

/** The group, and beside it a route whose own page does not run SvelteKit's client. */
function groupCell(route: RouteRecord): string {
  if (route.group === null) return NOT_RECORDED;
  return route.client === false ? `${route.group}, runs no client` : route.group;
}

function row(route: RouteRecord, policies: ProcessModel["policies"]): string {
  const cells = [
    route.method,
    `\`${route.path}\``,
    groupCell(route),
    route.session ?? NOT_RECORDED,
    route.rateLimit ?? NOT_RECORDED,
    bucketCell(route.rateLimit, policies),
    route.writeLimit ?? NOT_RECORDED,
    bucketCell(route.writeLimit, policies),
    route.bodyLimit === null ? NOT_RECORDED : String(route.bodyLimit),
    deadlineCell(route),
    yn(route.testOnly),
    yn(route.probe),
  ];
  cells.push(route.why, route.input, route.output, route.errors, route.auth);
  return `| ${cells.join(" | ")} |`;
}

function table(headers: readonly string[], rows: readonly string[]): string[] {
  return ["", `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows, ""];
}

function processPage(process: ProcessModel): string {
  const headers = [
    "Method",
    "Path (route id)",
    "Group",
    "Session",
    "Rate limit",
    "Buckets",
    "Write limit",
    "Write buckets",
    "Body limit (bytes)",
    "Deadline (ms)",
    "Test only",
    "Probe",
    "Why",
    "Input",
    "Output",
    "Errors",
    "Auth",
  ];
  const lines = [
    "---",
    `title: ${process.name}`,
    "weight: 1",
    "---",
    "",
    "Generated by `scripts/docs/endpoints.ts`. Do not edit.",
    "",
    `One row per route id under \`${ROUTES}/\`. Each row's policy source is that folder's \`policy.ts\`.`,
    `Buckets are from \`${LIMITS}\`; optional prose is from \`${DATA_DIR}/${process.name}.yaml\`.`,
    "Column rules and request-gate sources are on the Endpoints section page. An absent fact is `not recorded`.",
    "These are the app's own buckets. The edge has separate limits in `deployment/edge/`, not read here.",
    ...table(
      headers,
      process.routes.map((route) => row(route, process.policies)),
    ),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function policyTable(policies: ReadonlyMap<string, readonly Bucket[]>): string[] {
  const names = [...policies.keys()].sort(
    (a, b) => Number(b === "default") - Number(a === "default") || a.localeCompare(b),
  );
  return table(
    ["Policy", "Buckets"],
    names.map((name) => `| \`${name}\` | ${bucketText(policies.get(name) ?? [])} |`),
  );
}

function indexPage(model: EndpointModel): string {
  const lines = [
    "---",
    "title: Endpoints",
    "---",
    "",
    "Generated by `scripts/docs/endpoints.ts`. Do not edit.",
    "",
    "The web process's declared routes, read from the SvelteKit route tree.",
    "",
    ...model.processes.map((process) => `- [${process.name}](${process.name}/)`),
    "",
    "## How a cell is filled",
    "",
    `- **Path** is the route id relative to \`${ROUTES}\`, including SvelteKit parameters, encoded characters and layout groups. It is a route pattern, not a concrete request URL.`,
    "- **Method** lists exports of `+server.ts`/`+server.js`, GET for `+page` files, and POST for an exported `actions` in `+page.server.ts`/`+page.server.js`. SvelteKit 3.2.0 sources: `src/core/sync/create_manifest_data/index.js`, `src/runtime/server/endpoint.js` and `src/runtime/server/page/actions.js` in `interfaces/web/node_modules/@sveltejs/kit`. Implicit HEAD/OPTIONS are omitted; a handler may still refuse a method.",
    "- **Group, session, rate limit, write limit, body limit, deadline, test only, probe** copy `group` (with `client` where the route's own page does not run SvelteKit's client), `session`, `limit`, `writeLimit`, `maxBody`, `deadlineMs` (with `bodyWindowMs` where a route has one), `testOnly`, `probe` from that route's `policy.ts`. Missing fields are `not recorded`, not a claim that the runtime has no session, limit or deadline.",
    `- **Buckets, write buckets** copy the named entries of \`${LIMITS}\`'s \`policies\` export. These are the app's configured buckets, not the edge limits in \`deployment/edge/\` (not read here). \`policiesFor\` in the same file removes IP entries in socket mode and adds the login global ceiling.`,
    `- **Why, input, output, errors, auth** come only from \`${DATA_DIR}/web.yaml\`. Absent or empty prose is \`not recorded\`.`,
    "",
    "## Request gate sources",
    "",
    "`interfaces/web/src/lib/server/policy.ts` defines session modes. `interfaces/web/src/hooks.server.ts` applies them: `requestProblem` allows GET/HEAD and form POST with a declared body cap; `limitOf` chooses `writeLimit` for POST when present; `sessionProblem` reads sessions for explicit session modes or the app group, requires them for required/onboarding and for writes on non-read methods, and applies member buckets for required/onboarding/writes sessions. A probe skips the address and member limits. `withDeadline` falls back to `REQUEST_DEADLINE_MS` when the route has no deadline. Test-only routes require `TEST_ROUTES`.",
    "",
    "The same hook accepts only form media types for POST. SvelteKit's Origin check runs before the hook (`interfaces/web/node_modules/@sveltejs/kit/src/runtime/server/respond.js`, 3.2.0). These pages do not infer handler authorization from the session column.",
    "",
    "## Rate-limit policies",
    "",
    `Every entry of \`${LIMITS}\`'s \`policies\` export is listed, including names no route uses.`,
  ];
  for (const process of model.processes) {
    lines.push("", `### ${process.name}`);
    if (process.policies === null) lines.push("", "No such file.");
    else lines.push(...policyTable(process.policies));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Repo-relative path to generated text. The map order is the section page, then each process. */
export function renderEndpointFiles(model: EndpointModel): Map<string, string> {
  const files = new Map<string, string>([[`${CONTENT_DIR}/_index.md`, indexPage(model)]]);
  for (const process of model.processes) files.set(`${CONTENT_DIR}/${process.name}.md`, processPage(process));
  return files;
}

function diffFiles(root: string, files: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [rel, text] of files) {
    const abs = join(root, rel);
    if (!existsSync(abs)) problems.push(`${rel} is missing`);
    else if (readFileSync(abs, "utf8") !== text) problems.push(`${rel} differs from the generator`);
  }
  const dir = join(root, CONTENT_DIR);
  if (!existsSync(dir)) return problems.sort();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const rel = `${CONTENT_DIR}/${name}`;
    if (!files.has(rel)) problems.push(`${rel} is not produced by the generator`);
  }
  return problems.sort();
}

/** Problems, or the ways the committed pages differ. Empty means the tree matches. */
export async function checkEndpoints(root: string): Promise<readonly string[]> {
  const loaded = await loadEndpointModel(root);
  return loaded.ok ? diffFiles(root, renderEndpointFiles(loaded.model)) : loaded.problems;
}

/** Rewrites the pages. Returns problems and writes nothing when the inputs do not check. */
export async function writeEndpoints(root: string): Promise<readonly string[]> {
  const loaded = await loadEndpointModel(root);
  if (!loaded.ok) return loaded.problems;
  const files = renderEndpointFiles(loaded.model);
  const dir = join(root, CONTENT_DIR);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".md") && !files.has(`${CONTENT_DIR}/${name}`)) rmSync(join(dir, name));
    }
  }
  for (const [rel, text] of files) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return [];
}

async function main(): Promise<number> {
  const root = join(import.meta.dirname, "..", "..");
  const arg = process.argv[2] ?? "--write";
  if (arg !== "--check" && arg !== "--write") {
    console.error("usage: node scripts/docs/endpoints.ts [--check|--write]");
    return 2;
  }
  const problems = arg === "--check" ? await checkEndpoints(root) : await writeEndpoints(root);
  for (const problem of problems) console.error(problem);
  return problems.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(problemLine(error));
      process.exitCode = 1;
    },
  );
}
