// Endpoint pages for the Hugo docs (P0.09, issue #1161 section 3).
//
// Generated columns come from interfaces/<process>/routes.manifest.json and, for buckets, from
// interfaces/<process>/limits.ts. The policies export is imported, not parsed as text, the same way
// scripts/guards/route-policy.ts reads it. Prose columns come from docs/site/data/endpoints/<process>.yaml.
// A security fact those files do not state is the cell "not recorded".
//
// YAML is yaml 2.9.1 (node_modules/yaml/package.json). parseDocument uses the YAML 1.2 core schema,
// which is the library default (https://eemeli.org/yaml/#options, read 2026-10-21), with uniqueKeys and
// stringKeys (node_modules/yaml/dist/options.d.ts). toJS sets maxAliasCount to 0, which disallows aliases
// (same file, ToJSOptions.maxAliasCount). Sidebar order is front-matter weight, as Hextra v0.13.0 documents
// at https://imfing.github.io/hextra/docs/guide/organize-files/ (read 2026-10-21).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

export const NOT_RECORDED = "not recorded";

const CONTENT_DIR = "docs/site/content/endpoints";
const DATA_DIR = "docs/site/data/endpoints";
const MANIFEST = "routes.manifest.json";
const LIMITS = "limits.ts";
/** Outline order (issue #1161). Any other process follows, alphabetically. */
const PROCESS_ORDER = ["http", "admin", "api", "indexer", "media", "review"];
const KNOWN_FIELDS = new Set([
  "method",
  "path",
  "group",
  "accepts",
  "bodyLimit",
  "rateLimit",
  "mutates",
  "requiresSession",
  "handlerSession",
  "middleware",
  "deadlineMs",
]);
const NOTE_FIELDS = new Set(["why", "input", "output", "errors", "auth"]);
const PROSE_FIELDS = ["why", "input", "output", "errors", "auth"] as const;
const PROSE = /^[^\n|]{0,500}$/;
const SCOPES = new Set(["ip", "did", "global"]);
/**
 * Meanings taken from shared/http/server.ts middlewareOf and the checks it names. A name that is not
 * in this map stays "not recorded" rather than gaining a description from memory.
 */
const MIDDLEWARE: Readonly<Record<string, string>> = {
  requestId: "Request id, assigned before the route (shared/http/server.ts).",
  hostCheck: "Host is present and allowed. Not applied to /health (shared/http/server.ts).",
  trustedProxy: "Client address from the trusted proxy. Not applied to /health (shared/http/server.ts).",
  methodCheck: "Method is GET, HEAD or POST, and it matches the route (shared/http/server.ts).",
  contentTypeCheck: "A POST media type is one of accepts (shared/http/server.ts).",
  bodyLimit: "A POST body is capped (shared/http/server.ts).",
  rateLimitIp: "IP bucket of the named policy. Omitted when rateLimit is exempt (shared/http/server.ts).",
  csrf: "POST same-origin gate. The kit adds it for every POST (shared/http/server.ts).",
  session: "Present only when requiresSession is true (shared/http/server.ts).",
  rateLimitDid: "DID bucket. Present only when requiresSession is true (shared/http/server.ts).",
};

export type Bucket = { readonly scope: string; readonly capacity: number; readonly refillPerSec: number };

export type RouteRecord = {
  readonly method: string;
  readonly path: string;
  readonly group: string | null;
  readonly requiresSession: true | null;
  /** The handler reads the session and sends a signed-out visitor to /login; the kit does not (#1279). */
  readonly handlerSession: true | null;
  readonly middleware: readonly string[] | null;
  readonly rateLimit: string | null;
  readonly accepts: readonly string[] | null;
  readonly bodyLimit: number | null;
  readonly mutates: boolean | null;
  readonly deadlineMs: number | null;
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

const EMPTY_NOTE: HandNote = { why: "", input: "", output: "", errors: "", auth: "" };

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const formatNum = (n: number): string => (Object.is(n, -0) ? "0" : String(n));
const routeKey = (method: string, path: string): string => `${method} ${path}`;
const processRank = (name: string): number => {
  const index = PROCESS_ORDER.indexOf(name);
  return index === -1 ? PROCESS_ORDER.length : index;
};

function problemLine(error: unknown): string {
  const message = error instanceof Error ? error.message : "unreadable";
  return message.replaceAll("\n", " ").slice(0, 200);
}

function interfaceNames(root: string): { names: string[]; problems: string[] } {
  const dir = join(root, "interfaces");
  const names = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, MANIFEST)))
        .map((entry) => entry.name)
        .sort((a, b) => processRank(a) - processRank(b) || a.localeCompare(b))
    : [];
  if (names.length === 0) return { names: [], problems: ["interfaces: no routes.manifest.json found"] };
  return {
    names,
    problems: names
      .filter((name) => !/^[a-z][a-z0-9-]*$/.test(name))
      .map((name) => `interfaces/${name}: process name cannot be a page slug`),
  };
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
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
const nameList =
  (allowed: RegExp) =>
  (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.test(item)) ? value : undefined;
const sessionFlag = (value: unknown): true | undefined => (value === true ? true : undefined);

function readDraft(file: string, value: unknown, index: number): { draft: Draft | null; problems: string[] } {
  const problems: string[] = [];
  if (!isPlainObject(value)) return { draft: null, problems: [`${file}: route ${index} is not an object`] };
  const where = `${file}: route ${index}`;
  for (const field of Object.keys(value)) {
    if (!KNOWN_FIELDS.has(field)) problems.push(`${where} has unknown field ${field}`);
  }
  const method = typeof value.method === "string" && !/\s/.test(value.method) ? value.method : "";
  const path =
    typeof value.path === "string" && value.path.startsWith("/") && !/[\s`|]/.test(value.path) ? value.path : "";
  if (method === "") problems.push(`${where} has no method`);
  if (path === "") problems.push(`${where} has no path`);
  if (method === "" || path === "") return { draft: null, problems };
  // Field problems still keep the draft, so a bad cell does not also look like a missing route.
  const at = `${file}: ${routeKey(method, path)}`;
  // The kit sets at most one of them (shared/http/routes.ts), so both at once is a hand-edited manifest.
  if (value.requiresSession === true && value.handlerSession === true) {
    problems.push(`${at} sets both requiresSession and handlerSession`);
  }
  return {
    draft: {
      method,
      path,
      group: readField(value, "group", at, problems, oneLine, "group is not a single-line string"),
      rateLimit: readField(value, "rateLimit", at, problems, oneLine, "rateLimit is not a single-line string"),
      requiresSession: readField(value, "requiresSession", at, problems, sessionFlag, "requiresSession is not true"),
      handlerSession: readField(value, "handlerSession", at, problems, sessionFlag, "handlerSession is not true"),
      middleware: readField(
        value,
        "middleware",
        at,
        problems,
        nameList(/^[^\n`|]+$/),
        "middleware is not a list of names",
      ),
      accepts: readField(
        value,
        "accepts",
        at,
        problems,
        nameList(/^[^\n|,`]*$/),
        "accepts is not a list of media types",
      ),
      bodyLimit: readField(value, "bodyLimit", at, problems, count, "bodyLimit is not a positive integer"),
      mutates: readField(value, "mutates", at, problems, flag, "mutates is not a boolean"),
      deadlineMs: readField(value, "deadlineMs", at, problems, count, "deadlineMs is not a positive integer"),
    },
    problems,
  };
}

function readManifest(root: string, name: string): { drafts: Draft[]; problems: string[] } {
  const file = `interfaces/${name}/${MANIFEST}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, file), "utf8"));
  } catch (error) {
    return { drafts: [], problems: [`${file}: ${problemLine(error)}`] };
  }
  if (!Array.isArray(parsed)) return { drafts: [], problems: [`${file}: routes manifest is not an array`] };
  const drafts: Draft[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of parsed.entries()) {
    const read = readDraft(file, value, index);
    problems.push(...read.problems);
    if (read.draft === null) continue;
    const key = routeKey(read.draft.method, read.draft.path);
    if (seen.has(key)) problems.push(`${file}: duplicate ${key}`);
    seen.add(key);
    drafts.push(read.draft);
  }
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
    } else note[field] = text;
  }
  return { note, problems };
}

function readNotes(root: string, name: string): { notes: Map<string, HandNote>; problems: string[] } {
  const file = `${DATA_DIR}/${name}.yaml`;
  const abs = join(root, file);
  if (!existsSync(abs)) return { notes: new Map(), problems: [`${file}: missing`] };
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
    parsed = doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    return { notes: new Map(), problems: [`${file}: ${problemLine(error)}`] };
  }
  if (!isPlainObject(parsed)) return { notes: new Map(), problems: [`${file}: expected a mapping of "METHOD path"`] };
  const notes = new Map<string, HandNote>();
  const problems: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[A-Z]+ \/\S*$/.test(key)) problems.push(`${file}: bad key "${key}"`);
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
  name: string,
): Promise<{ policies: ReadonlyMap<string, readonly Bucket[]> | null; problems: string[] }> {
  const file = `interfaces/${name}/${LIMITS}`;
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

function policyProblem(name: string, draft: Draft, policies: ProcessModel["policies"]): string | null {
  if (draft.rateLimit === null || draft.rateLimit === "exempt") return null;
  const file = `interfaces/${name}/${LIMITS}`;
  const key = routeKey(draft.method, draft.path);
  if (policies === null) return `${file}: ${key} names "${draft.rateLimit}" but the file does not exist`;
  if (!policies.has(draft.rateLimit))
    return `${file}: ${key} names "${draft.rateLimit}" but no such policy is exported`;
  return null;
}

/** A data-file key with no manifest route. A key that already failed the key pattern is not also an orphan. */
function orphanProblems(file: string, notes: ReadonlyMap<string, HandNote>, seen: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const key of notes.keys()) {
    if (seen.has(key)) continue;
    if (!/^[A-Z]+ \/\S*$/.test(key)) continue;
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
    if (noted === undefined) problems.push(`${file}: missing key "${key}"`);
    const limit = policyProblem(name, draft, policies);
    if (limit !== null) problems.push(limit);
    routes.push({ ...draft, ...(noted ?? EMPTY_NOTE) });
  }
  return { process: { name, routes, policies }, problems: [...problems, ...orphanProblems(file, notes, seen)] };
}

/** The pages the committed tree must match, or the problems that stop a write. */
export async function loadEndpointModel(root: string): Promise<LoadResult> {
  const found = interfaceNames(root);
  const problems = [...found.problems];
  const processes: ProcessModel[] = [];
  for (const name of found.names) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
    const manifest = readManifest(root, name);
    const notes = readNotes(root, name);
    const policies = await readPolicies(root, name);
    problems.push(...manifest.problems, ...notes.problems, ...policies.problems);
    const built = assemble(name, manifest.drafts, notes.notes, policies.policies);
    problems.push(...built.problems);
    processes.push(built.process);
  }
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

function sessionCell(route: RouteRecord): string {
  if (route.requiresSession === true) return "required";
  return route.handlerSession === true ? "required (handler)" : NOT_RECORDED;
}

function csrfCell(route: RouteRecord): string {
  if (route.middleware === null) return NOT_RECORDED;
  return route.middleware.includes("csrf") ? "yes" : "no";
}

function bucketCell(route: RouteRecord, policies: ProcessModel["policies"]): string {
  if (route.rateLimit === null || policies === null) return NOT_RECORDED;
  const buckets = policies.get(route.rateLimit);
  return buckets === undefined ? NOT_RECORDED : bucketText(buckets);
}

function acceptsCell(route: RouteRecord): string {
  if (route.accepts === null) return NOT_RECORDED;
  return route.accepts.length === 0 ? "none" : route.accepts.join(", ");
}

const yn = (value: boolean | null): string => (value === null ? NOT_RECORDED : value ? "yes" : "no");

function row(route: RouteRecord, policies: ProcessModel["policies"], deadline: boolean): string {
  const cells = [
    route.method,
    `\`${route.path}\``,
    "built",
    route.group ?? NOT_RECORDED,
    sessionCell(route),
    csrfCell(route),
    route.rateLimit ?? NOT_RECORDED,
    bucketCell(route, policies),
    acceptsCell(route),
    route.bodyLimit === null ? NOT_RECORDED : String(route.bodyLimit),
    yn(route.mutates),
    route.middleware === null ? NOT_RECORDED : route.middleware.join(" → "),
  ];
  if (deadline) cells.push(route.deadlineMs === null ? NOT_RECORDED : String(route.deadlineMs));
  cells.push(route.why, route.input, route.output, route.errors, route.auth);
  return `| ${cells.join(" | ")} |`;
}

function table(headers: readonly string[], rows: readonly string[]): string[] {
  return ["", `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows, ""];
}

/** Known processes use the outline order. Any other process follows, in sorted order. */
function pageWeight(name: string, names: readonly string[]): number {
  const rank = processRank(name);
  if (rank < PROCESS_ORDER.length) return rank + 1;
  return 50 + names.filter((item) => processRank(item) === PROCESS_ORDER.length).indexOf(name);
}

function processPage(process: ProcessModel, names: readonly string[]): string {
  const rows = process.routes;
  const deadline = rows.some((route) => route.deadlineMs !== null);
  const headers = [
    "Method",
    "Path",
    "Status",
    "Group",
    "Session",
    "CSRF",
    "Rate limit",
    "Buckets",
    "Accepts",
    "Body limit",
    "Mutates",
    "Middleware",
  ];
  if (deadline) headers.push("Deadline");
  headers.push("Why", "Input", "Output", "Errors", "Auth");
  const onlyHealth =
    process.routes.length === 1 && process.routes[0]?.method === "GET" && process.routes[0]?.path === "/health";
  const lines = [
    "---",
    `title: ${process.name}`,
    `weight: ${pageWeight(process.name, names)}`,
    "---",
    "",
    "Generated by `scripts/docs/endpoints.ts`. Do not edit.",
    "",
    `Routes recorded in \`interfaces/${process.name}/${MANIFEST}\`. Prose is from \`${DATA_DIR}/${process.name}.yaml\`.`,
    "Column rules are on the Endpoints section page. A security cell is `not recorded` when the manifest or `limits.ts` does not state it.",
  ];
  if (onlyHealth) lines.push("This manifest records only `GET /health`.");
  if (process.policies === null) lines.push(`This process has no \`interfaces/${process.name}/${LIMITS}\`.`);
  lines.push(
    ...table(
      headers,
      rows.map((route) => row(route, process.policies, deadline)),
    ),
  );
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
  const middleware = new Set<string>();
  const groups = new Set<string>();
  for (const process of model.processes) {
    for (const route of process.routes) {
      for (const name of route.middleware ?? []) middleware.add(name);
      if (route.group !== null) groups.add(route.group);
    }
  }
  const lines = [
    "---",
    "title: Endpoints",
    "---",
    "",
    "Generated by `scripts/docs/endpoints.ts`. Do not edit.",
    "",
    "One page per interface process that has a `routes.manifest.json`.",
    "",
    ...model.processes.map((process) => `- [${process.name}](${process.name}/)`),
    "",
    "## How a cell is filled",
    "",
    "- **Method, path, group, accepts, body limit, mutates, middleware** are copied from the manifest. An absent field is `not recorded`. An empty `accepts` array is `none`.",
    '- **Session** is the manifest, unchanged: `required` when `requiresSession` is true (the kit checks it), and `required (handler)` when `handlerSession` is true (the handler sends a signed-out visitor to /login, and the kit only records it). `shared/http/routes.ts` omits both fields otherwise, and these pages do not read that omission as "no session". A manifest session of none is not a claim that the handler does no auth.',
    "- **Auth** is the data file, from the handler, not the manifest. `gate: openApp` when the handler calls `openApp`. `reads session` when it calls `readSession`. `none` otherwise.",
    "- **CSRF** is `yes` when `middleware` includes `csrf`, and `no` when the array is present and does not include it. A missing array is `not recorded`.",
    "- **Rate limit** is the manifest `rateLimit` string. **Buckets** are that name's entries in `interfaces/<process>/limits.ts`. `exempt` is not a key of that table, so its buckets cell is `not recorded`.",
    "- **Status** is `built` for a manifest route.",
    "- **Why, input, output, errors** are the data file. They are prose, not a second copy of the security columns.",
    "",
    "## Groups",
    "",
    "The manifest field `group` is copied as recorded. `shared/http/csp/headers.ts` uses that same value when it sets `content-security-policy`. The manifest has no separate CSP-group field, so these pages do not name one.",
    "",
    [...groups]
      .sort()
      .map((group) => `\`${group}\``)
      .join(", "),
    "",
    "## Middleware",
    ...table(
      ["Name", "Recorded meaning"],
      [...middleware].sort().map((name) => `| \`${name}\` | ${MIDDLEWARE[name] ?? NOT_RECORDED} |`),
    ),
    "## Rate-limit policies",
    "",
    "Every policy a process's `limits.ts` exports is listed, including one no current route names.",
  ];
  for (const process of model.processes) {
    lines.push("", `### ${process.name}`, "", `\`${`interfaces/${process.name}/${LIMITS}`}\``);
    if (process.policies === null) lines.push("", "No such file.");
    else lines.push(...policyTable(process.policies));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Repo-relative path to generated text. The map order is the section page, then each process. */
export function renderEndpointFiles(model: EndpointModel): Map<string, string> {
  const names = model.processes.map((process) => process.name);
  const files = new Map<string, string>([[`${CONTENT_DIR}/_index.md`, indexPage(model)]]);
  for (const process of model.processes) files.set(`${CONTENT_DIR}/${process.name}.md`, processPage(process, names));
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
