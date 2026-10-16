// Breaking-change check (P1.31g). A published record or query schema may only gain optional fields or widen limits;
// anything else needs a new NSID, because records already in users' repositories must stay valid. The permission
// set follows its own rules: the authorization server rebuilds every token's scope from the current set at refresh
// (@atproto/oauth-provider, token/token-manager.ts:255-260), so an addition widens every grant within minutes and
// needs Alex's approval, and a removal breaks running features and is refused.
// Usage: node scripts/breaking-check.ts [--approved-by-alex=<PR number>]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE = join(import.meta.dirname, "..");

type Def = Record<string, unknown>;
type Doc = { id: string; defs: Record<string, Def> };
type Options = { approvedByAlex?: number };
type Lock = Record<string, { cid: string; schemaRecordCid: string; publishedAt: string }>;

/** Limits that may only grow, and limits that may only shrink, in a published schema. */
const MAXIMA = ["maxLength", "maxGraphemes", "maxSize", "maximum"];
const MINIMA = ["minLength", "minGraphemes", "minimum"];
const FIXED = ["type", "format", "const", "ref"];
const CONSENT = ["title", "title:lang", "detail", "detail:lang"];

/** Every way `next` breaks the published `before`; empty means it may be published under the same NSID. */
export function breakingProblems(next: Doc, before: Doc, options: Options): string[] {
  if (before.defs.main?.type === "permission-set") return permissionSetChanges(next, before, options);
  return Object.entries(before.defs).flatMap(([name, def]) => {
    const now = next.defs[name];
    const at = `${before.id}#${name}`;
    if (!now) return [`${at}: definition removed`];
    if (def.type === "record" && now.key !== def.key) {
      return [`${at}: record key changed from ${def.key} to ${now.key}`, ...compareDef(at, now.record, def.record)];
    }
    return def.type === "record" ? compareDef(at, now.record, def.record) : compareDef(at, now, def);
  });
}

function compareDef(at: string, nowValue: unknown, beforeValue: unknown): string[] {
  const now = (nowValue ?? {}) as Def;
  const before = (beforeValue ?? {}) as Def;
  const problems = [
    ...FIXED.filter((key) => now[key] !== before[key]).map(
      (key) => `${at}: ${key} changed from ${String(before[key])} to ${String(now[key])}`,
    ),
    ...narrowedLimits(at, now, before),
    ...lostValues(at, now, before),
  ];
  if (now.closed === true && before.closed !== true) problems.push(`${at}: union became closed`);
  if (before.items) problems.push(...compareDef(`${at}[]`, now.items, before.items));
  if (before.type === "object") problems.push(...compareObject(at, now, before));
  return problems;
}

function narrowedLimits(at: string, now: Def, before: Def): string[] {
  const narrower = (key: string, isNarrower: (is: number, was: number) => boolean): string[] => {
    const [was, is] = [before[key], now[key]] as (number | undefined)[];
    const narrowed = is !== undefined && (was === undefined || isNarrower(is, was));
    return narrowed ? [`${at}: ${key} narrowed from ${was ?? "none"} to ${is}`] : [];
  };
  return [
    ...MAXIMA.flatMap((key) => narrower(key, (is, was) => is < was)),
    ...MINIMA.flatMap((key) => narrower(key, (is, was) => is > was)),
  ];
}

function lostValues(at: string, now: Def, before: Def): string[] {
  return ["enum", "accept", "refs"].flatMap((key) => {
    const was = before[key] as unknown[] | undefined;
    const is = now[key] as unknown[] | undefined;
    const lost = is === undefined ? [] : (was ?? ["any value"]).filter((value) => !is.includes(value));
    return lost.length > 0 ? [`${at}: ${key} no longer allows ${lost.join(", ")}`] : [];
  });
}

function compareObject(at: string, now: Def, before: Def): string[] {
  const nowProps = (now.properties ?? {}) as Record<string, Def>;
  const required = new Set((before.required ?? []) as string[]);
  const problems = ((now.required ?? []) as string[])
    .filter((field) => !required.has(field))
    .map((field) => `${at}: ${field} became required`);
  for (const [field, def] of Object.entries((before.properties ?? {}) as Record<string, Def>)) {
    const path = `${at}.${field}`;
    problems.push(...(nowProps[field] ? compareDef(path, nowProps[field], def) : [`${path}: field removed`]));
  }
  return problems;
}

function permissionSetChanges(next: Doc, before: Doc, options: Options): string[] {
  const [now, was] = [scopesOf(next), scopesOf(before)];
  const needsFlag = options.approvedByAlex === undefined;
  const problems = [...was]
    .filter((s) => !now.has(s))
    .map((s) => `${before.id}: removes ${s}; retire the feature first`);
  if (!needsFlag) return problems;
  for (const scope of now) {
    if (!was.has(scope))
      problems.push(`${before.id}: adds ${scope}, which widens every existing grant; needs --approved-by-alex=<PR>`);
  }
  const [nowMain, wasMain] = [next.defs.main ?? {}, before.defs.main ?? {}];
  const changed = CONSENT.filter((key) => JSON.stringify(nowMain[key]) !== JSON.stringify(wasMain[key]));
  if (changed.length > 0) {
    problems.push(
      `${before.id}: changes the consent text users see (${changed.join(", ")}); needs --approved-by-alex=<PR>`,
    );
  }
  return problems;
}

/** Each permission as one scope token per resource name, as an authorization server would expand it. */
function scopesOf(doc: Doc): Set<string> {
  const permissions = (doc.defs.main?.permissions ?? []) as Record<string, unknown>[];
  return new Set(
    permissions.flatMap(({ type: _, resource, collection, lxm, ...params }) => {
      const query = Object.entries(params)
        .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((v) => `${key}=${String(v)}`))
        .join("&");
      const names = (resource === "repo" ? collection : lxm) as string[] | undefined;
      return (names ?? []).map((name) => `${String(resource)}:${name}${query ? `?${query}` : ""}`);
    }),
  );
}

/** Compares each NSID in published.lock.json with its published/<nsid>.json snapshot. */
export function publishedProblems(options: Options, root = PACKAGE): string[] {
  const lock = JSON.parse(readFileSync(join(root, "published.lock.json"), "utf8")) as Lock;
  const read = (dir: string, nsid: string) => JSON.parse(readFileSync(join(root, dir, `${nsid}.json`), "utf8")) as Doc;
  return Object.keys(lock).flatMap((nsid) => breakingProblems(read("schemas", nsid), read("published", nsid), options));
}

if (import.meta.main) {
  const flag = process.argv.find((arg) => arg.startsWith("--approved-by-alex="))?.split("=")[1];
  const approvedByAlex = flag && /^[1-9][0-9]*$/.test(flag) ? Number(flag) : undefined;
  if (flag !== undefined && approvedByAlex === undefined) {
    process.stderr.write("--approved-by-alex takes the number of the PR Alex approved\n");
    process.exit(2);
  }
  const problems = publishedProblems(approvedByAlex === undefined ? {} : { approvedByAlex });
  for (const problem of problems) process.stderr.write(`breaking: ${problem}\n`);
  if (problems.length > 0)
    process.stderr.write("breaking: publish a new NSID (records) or get Alex's approval (permission set)\n");
  process.exit(problems.length > 0 ? 1 : 0);
}
