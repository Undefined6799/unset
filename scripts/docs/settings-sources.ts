// Everything else the settings pages show (P1.21a): edge zones and headers, web's rate-limit policies and security
// headers, a named list of constants fixed in code, and the member settings pages with their notes. Each reader fails
// on a shape it does not know rather than guess.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  cell,
  code,
  containerRows,
  importNamed,
  isObject,
  loadStacks,
  otherServices,
  type ProcessSettings,
  pdsAdminProcess,
  type Row,
  SCHEMAS,
  schemaSettings,
} from "./settings-process.ts";

export const NOTES = "docs/site/data/settings.yaml";
/** Values fixed in code that a person may want to change. A missing export fails the check. */
const CONSTANTS = [
  {
    file: "shared/lexicons/src/limits.ts",
    names: ["LIMITS", "IMAGE_ACCEPT"],
    note: "lexicon: permanent once published",
  },
  { file: "domains/profile/profile.ts", names: ["APP_LIMITS"], note: "profile editor" },
  { file: "domains/profile/card-edit.ts", names: ["CARD_EDIT_LIMITS"], note: "card editor rows per list" },
  { file: "domains/profile/card-edit.ts", names: ["TEXT_EDIT_BYTES"], note: "card editor Markdown bytes" },
  { file: "domains/profile/discoverability.ts", names: ["DISCOVERABILITY_LIMITS"], note: "Search and AI text" },
  {
    file: "domains/profile/crawlers.ts",
    names: ["MAX_AI_SEARCH_PAGES", "MAX_SITEMAP_PAGES"],
    note: "robots and sitemap",
  },
  {
    file: "domains/profile/index-plan.ts",
    names: ["MAX_PAGE_BYTES", "MAX_RECORD_BYTES", "MAX_SECTIONS_PER_ACCOUNT"],
    note: "indexer",
  },
  { file: "infrastructure/postgres/accountStore.ts", names: ["MAX_CONFIRM_DAYS"], note: "account status retries" },
  { file: "infrastructure/seal/seal.ts", names: ["MAX_PLAINTEXT"], note: "sealed storage" },
] as const;

/** Settings with a security role, shown again on the security page. A key no process has fails the check. */
export const SECURITY_KEYS = [
  "SESSION_IDLE_S",
  "SESSION_ABSOLUTE_S",
  "TRUSTED_PROXY_MODE",
  "HTTP_ALLOWED_HOSTS",
  "HTTP_BODY_LIMIT_BYTES",
  "REQUEST_DEADLINE_MS",
  "RATE_LIMIT_MAX_KEYS",
  "EMAIL_RECHECK_S",
  "MIN_AGE",
  "TEST_ROUTES",
  "SIGNUPS_OPEN",
] as const;

export type SettingsModel = {
  readonly processes: readonly ProcessSettings[];
  readonly otherServices: readonly { readonly service: string; readonly rows: readonly Row[] }[];
  readonly containers: readonly Row[];
  readonly edgeZones: readonly Row[];
  readonly edgeHeaders: readonly Row[];
  readonly appPolicies: readonly Row[];
  readonly webHeaders: readonly Row[];
  readonly pageCsp: readonly Row[];
  readonly constants: readonly Row[];
  readonly memberPages: readonly Row[];
};
export type LoadResult = { ok: true; model: SettingsModel } | { ok: false; problems: readonly string[] };

function zoneRows(file: string, key: string, zones: unknown, problems: string[]): Row[] {
  const host = key === "appRateLimitZones" ? "app host" : "PDS host";
  return Object.entries(isObject(zones) ? zones : {}).flatMap(([zone, z]) => {
    if (isObject(z) && typeof z.events === "number" && typeof z.window === "string") {
      return [[code(zone), host, `${z.events} per ${z.window}`]];
    }
    problems.push(`${file}: zone ${zone} is not { events, window }`);
    return [];
  });
}

function edgeZones(root: string, problems: string[]): Row[] {
  const file = "deployment/edge/limits.json";
  const json: unknown = JSON.parse(readFileSync(join(root, file), "utf8"));
  return Object.entries(isObject(json) ? json : {}).flatMap(([key, value]): Row[] => {
    if (typeof value === "number") return [[code(key), "setting", code(String(value))]];
    if (key.endsWith("Zones")) return zoneRows(file, key, value, problems);
    problems.push(`${file}: unknown key ${key}`);
    return [];
  });
}

const HOW: Readonly<Record<string, string>> = { "-": "removed", "?": "set if absent", "": "set" };

/** One header directive, inside a `header {` block or on its own `header` line, or null. */
function headerLine(line: string, inBlock: boolean): Row | null {
  const m = (inBlock ? /^([?-]?)([A-Za-z-]+)(?: (.+))?$/ : /^header ([?-]?)([A-Za-z-]+)(?: (.+))?$/).exec(line);
  if (m === null) return null;
  return [code(m[2] ?? ""), HOW[m[1] ?? ""] ?? "set", m[3] ? code(m[3].replace(/^"|"$/g, "")) : ""];
}

/** Each header of the edge's security snippets: set, set if absent (`?`) or removed (`-`). */
function edgeHeaders(root: string, problems: string[]): Row[] {
  const file = "deployment/edge/snippets/security-headers.caddy";
  const rows: Row[] = [];
  let snippet = "";
  let inBlock = false;
  const lines = readFileSync(join(root, file), "utf8")
    .split("\n")
    .map((raw) => raw.trim());
  for (const line of lines.filter((l) => l !== "" && !l.startsWith("#"))) {
    const opened = /^\(([a-z-]+)\) \{$/.exec(line);
    if (opened) snippet = opened[1] ?? "";
    else if (line === "header {" || line === "}") inBlock = line === "header {";
    else {
      const row = headerLine(line, inBlock);
      if (row === null) problems.push(`${file}: unrecognised line "${line.slice(0, 60)}"`);
      else rows.push([code(snippet), ...row]);
    }
  }
  return rows;
}

type Bucket = { scope: string; capacity: number; refillPerSec: number };
const refill = (perSec: number): string =>
  perSec * 60 >= 1 ? `${Math.round(perSec * 6000) / 100} a minute` : `${Math.round(perSec * 360000) / 100} an hour`;

async function appPolicies(root: string): Promise<Row[]> {
  const policiesFor = (await importNamed(root, "interfaces/web/src/lib/server/limits.ts", "policiesFor")) as (
    mode: string,
  ) => Record<string, readonly Bucket[]>;
  return (["header", "socket"] as const).flatMap((mode) =>
    Object.entries(policiesFor(mode)).flatMap(([name, buckets]) =>
      buckets.map((b) => [mode, code(name), b.scope, String(b.capacity), refill(b.refillPerSec)]),
    ),
  );
}

const EXAMPLE = { PUBLIC_ORIGIN: "https://app.example.test", MEDIA_ORIGIN: "https://media.example.net" } as const;
const named = (value: string): string =>
  value.replaceAll(EXAMPLE.PUBLIC_ORIGIN, "<PUBLIC_ORIGIN>").replaceAll(EXAMPLE.MEDIA_ORIGIN, "<MEDIA_ORIGIN>");

async function webHeaders(root: string): Promise<{ base: Row[]; pages: Row[] }> {
  const csp = "interfaces/web/src/lib/server/csp.ts";
  const staticCsp = (await importNamed(root, csp, "STATIC_CSP")) as string;
  const security = (await importNamed(root, "shared/http/headers.ts", "SECURITY_HEADERS")) as Record<string, string>;
  const sent = { "content-security-policy": staticCsp, ...security };
  const base = Object.entries(sent).map(([name, value]) => [code(name), code(named(value))]);
  const zeroScript = (await importNamed(root, csp, "zeroScriptCsp")) as (origin: string) => Record<string, string>;
  const groups = zeroScript(EXAMPLE.PUBLIC_ORIGIN);
  const pages = Object.entries(groups).map(([group, csp]) => [
    code(group),
    group === "app"
      ? `SvelteKit's own (kit.csp in interfaces/web/vite.config.ts); fallback ${code(named(csp))}`
      : code(named(csp)),
  ]);
  return { base, pages };
}

function flatten(prefix: string, value: unknown): [string, string][] {
  if (isObject(value)) return Object.entries(value).flatMap(([k, v]) => flatten(`${prefix}.${k}`, v));
  return [[prefix, Array.isArray(value) ? value.join(", ") : String(value)]];
}

async function constants(root: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (const entry of CONSTANTS) {
    for (const name of entry.names) {
      for (const [path, value] of flatten(name, await importNamed(root, entry.file, name))) {
        rows.push([code(path), code(value), entry.note, `\`${entry.file}\``]);
      }
    }
  }
  return rows;
}

/** Member-facing settings pages: every folder under /settings and /prefs, each with a note from the data file. */
export function memberPages(pages: readonly string[], notes: unknown): { rows: Row[]; problems: string[] } {
  const problems: string[] = [];
  const map = isObject(notes) && isObject(notes.memberPages) ? notes.memberPages : {};
  for (const path of Object.keys(map)) if (!pages.includes(path)) problems.push(`${NOTES}: ${path} is not a page`);
  const rows = pages.map((path) => {
    const note = map[path];
    if (typeof note !== "string" || note === "") problems.push(`${NOTES}: no note for ${path}`);
    return [code(path), cell(typeof note === "string" ? note : "")];
  });
  return { rows, problems };
}

function memberRoutes(root: string): string[] {
  return ["settings", "prefs"]
    .flatMap((top) =>
      readdirSync(join(root, "interfaces/web/src/routes", top), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `/${top}/${d.name}`),
    )
    .sort();
}

export async function loadSettingsModel(root: string): Promise<LoadResult> {
  const problems: string[] = [];
  try {
    const stacks = loadStacks(root, problems);
    const processes = [...(await schemaSettings(root, stacks, problems)), pdsAdminProcess(root, stacks, problems)];
    const known = new Set<string>([...SCHEMAS.flatMap((s) => (s.service ? [s.service] : [])), "pds-admin"]);
    const keys = new Set(processes.flatMap((p) => p.settings.map((s) => s.key)));
    for (const key of SECURITY_KEYS) if (!keys.has(key)) problems.push(`security key ${key} is in no process`);
    const headers = await webHeaders(root);
    const notesPath = join(root, NOTES);
    const notes: unknown = existsSync(notesPath) ? parseYaml(readFileSync(notesPath, "utf8")) : {};
    const member = memberPages(memberRoutes(root), notes);
    problems.push(...member.problems);
    const model: SettingsModel = {
      processes,
      otherServices: otherServices(stacks, known),
      containers: containerRows(stacks),
      edgeZones: edgeZones(root, problems),
      edgeHeaders: edgeHeaders(root, problems),
      appPolicies: await appPolicies(root),
      webHeaders: headers.base,
      pageCsp: headers.pages,
      constants: await constants(root),
      memberPages: member.rows,
    };
    return problems.length === 0 ? { ok: true, model } : { ok: false, problems };
  } catch (error) {
    return { ok: false, problems: [...problems, error instanceof Error ? error.message : "unreadable"] };
  }
}
