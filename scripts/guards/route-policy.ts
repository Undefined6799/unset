// Guard (P1.06q, SE-6; architecture ruling 2026-10-05): every route in an interface's routes.manifest.json names a
// rate-limit policy in that interface's own limits.ts, or is "exempt" on a static route. An interface with no
// limits.ts is never skipped: it passes only while every route in it is exempt and static. limits.ts is read by
// importing it and taking the keys of its `policies` export, never by pattern, so an unexpected shape fails closed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Finding } from "./files.ts";

const RULE = "route-policy";
const MANIFEST = "routes.manifest.json";
const LIMITS = "limits.ts";

type Route = { method: string; path: string; rateLimit: string; group: string };
export type RoutePolicyScan = { findings: Finding[]; warnings: string[] };

const finding = (file: string, text: string): Finding => ({ file, line: 1, rule: RULE, text });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Step 1: the folders directly under interfaces/ that hold a routes manifest, sorted. */
function interfacesWithManifest(root: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(root, "interfaces"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return names.filter((name) => existsSync(join(root, "interfaces", name, MANIFEST))).sort();
}

/** Step 2: the manifest's routes, or a finding naming the file when it is not an array of route objects. */
function readManifest(root: string, file: string): unknown[] | Finding {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, file), "utf8"));
  } catch {
    return finding(file, "unparsable routes manifest");
  }
  return Array.isArray(parsed) ? parsed : finding(file, "routes manifest is not an array");
}

/** Step 3: the policy names exported by limits.ts as `policies`, or a finding naming the file. */
async function readPolicies(root: string, file: string): Promise<Set<string> | Finding> {
  let policies: unknown;
  try {
    ({ policies } = (await import(pathToFileURL(join(root, file)).href)) as { policies?: unknown });
  } catch {
    return finding(file, "limits.ts could not be imported");
  }
  if (policies === undefined) return finding(file, "limits.ts has no `policies` export");
  if (!isPlainObject(policies)) return finding(file, "`policies` in limits.ts is not a plain object");
  return new Set(Object.keys(policies));
}

/** Step 4: one route against its interface's policies (null when the interface has no limits.ts). */
function checkRoute(file: string, route: unknown, policies: Set<string> | null, limitsFile: string): Finding | null {
  const r = (isPlainObject(route) ? route : {}) as Partial<Record<keyof Route, unknown>>;
  const name = `${typeof r.method === "string" ? r.method : "?"} ${typeof r.path === "string" ? r.path : "?"}`;
  if (typeof r.rateLimit !== "string") return finding(file, `${name}: no rateLimit`);
  if (typeof r.group !== "string") return finding(file, `${name}: no group`);
  if (r.rateLimit === "exempt") return r.group === "static" ? null : finding(file, `${name}: "exempt" outside static`);
  if (policies === null) return finding(file, `${name}: names "${r.rateLimit}" but ${limitsFile} does not exist`);
  if (!policies.has(r.rateLimit)) return finding(file, `${name}: "${r.rateLimit}" is not a policy in ${limitsFile}`);
  return null;
}

/** Steps 2–5 for one interface: its manifest, its policies, each route, and the policies no route uses. */
async function scanInterface(root: string, name: string, out: RoutePolicyScan): Promise<void> {
  const manifestFile = `interfaces/${name}/${MANIFEST}`;
  const limitsFile = `interfaces/${name}/${LIMITS}`;
  const routes = readManifest(root, manifestFile);
  if (!Array.isArray(routes)) {
    out.findings.push(routes);
    return;
  }
  const policies = existsSync(join(root, limitsFile)) ? await readPolicies(root, limitsFile) : null;
  if (policies !== null && !(policies instanceof Set)) {
    out.findings.push(policies); // a broken limits.ts fails the interface; its routes are not checked against it
    return;
  }
  const used = new Set<string>();
  for (const route of routes) {
    const found = checkRoute(manifestFile, route, policies, limitsFile);
    if (found) out.findings.push(found);
    if (isPlainObject(route) && typeof route.rateLimit === "string") used.add(route.rateLimit);
  }
  for (const policy of policies ?? []) {
    if (!used.has(policy)) out.warnings.push(`${limitsFile}: policy "${policy}" is used by no route`);
  }
}

/** Every interface with a manifest; none at all fails (AB-4). Findings fail the guard; warnings do not (P1.06p). */
export async function scanRoutePolicy(root: string): Promise<RoutePolicyScan> {
  const names = interfacesWithManifest(root);
  if (names.length === 0) return { findings: [finding("interfaces", `no ${MANIFEST} found`)], warnings: [] };
  const out: RoutePolicyScan = { findings: [], warnings: [] };
  for (const name of names) await scanInterface(root, name, out);
  return out;
}

/** The guard over a repository: findings only, with each warning printed. */
export async function scanAll(root: string): Promise<Finding[]> {
  const { findings, warnings } = await scanRoutePolicy(root);
  for (const warning of warnings) console.warn(`[${RULE}] warning: ${warning}`);
  return findings;
}
