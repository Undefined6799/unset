// Book P1.22j (ADR 0116 point 7): every answer the built web server gives, with the Content-Security-Policy it carries
// pinned by value. Which answers may run script is a list a reviewer reads here, in two tables: ROUTES names every
// route of the build with what a GET of it and of its data address answers, to a visitor and to a member; OTHERS names
// the answers that are no route's own (a path no route matches, the gate's refusals, a form post, a build file). A
// route the build has and ROUTES does not name fails, and so does a row with no route: a page nobody named cannot
// merge. Every answer, whatever the tables say of it, is also held to the rules in `held` below.
// The app policy is pinned in gate.test.ts too (ADR 0054); here it is one of the values an answer may carry.
// Asked with GET, and POST for the forms; one of each kind again with HEAD, held to its GET. Not asked, because the
// build cannot be made to give them: the gate's refusal of a route with no policy.ts (gate.test.ts
// every_route_has_a_policy keeps one from existing) and of an error the gate itself catches (gate.test.ts
// a_session_store_outage_is_its_503). Both leave the gate by the same `plain` refusal as the ones asked here
// (interfaces/web/src/hooks.server.ts).
// Postgres as `web` and, for the one indexed profile, as `indexer` (TE-2); the PDS is stood in (TE-1).
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, PRIVACY_VERSION, parseDid, TERMS_VERSION } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import {
  createAccountRepository,
  createOAuthSessionStore,
  createPool,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import {
  buildOnce,
  ORIGIN,
  PDS_HOST,
  type RunningWeb,
  type StandInFixture,
  startWeb,
  type WebRequest,
} from "./built-server.ts";
import { DATA, elementsOf, inlineScripts, scriptCount, startup } from "./data-address.ts";
import { readyMember } from "./members.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");
const WEB = join(REPO, "interfaces", "web");
const SOURCE = join(WEB, "src", "routes");
const BUILD = `${ORIGIN}/_app/`;

// ---------------------------------------------------------------------------------------------------------------------
// The pinned headers. An answer's Content-Security-Policy is one of these, by value, or the test fails.

const START_UP = "'sha256-<start-up script>'";
/** The app group's policy (ADR 0054 decision 4; kit.csp in vite.config.ts, narrowed by csp.ts) around its script-src. */
const appPolicy = (scripts: string): string =>
  `default-src 'none'; connect-src 'self'; font-src ${ORIGIN}/fonts/; img-src 'self'; manifest-src 'self'; ` +
  `object-src 'none'; script-src ${scripts}; style-src ${BUILD}; style-src-attr 'unsafe-hashes' ` +
  "'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=' 'sha256-VLgFcXpEe+O6FcWgF9ZsmG0zmp66HOx0AKvg+TMAbTo='; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; " +
  "trusted-types svelte-trusted-html sveltekit-trusted-url ProseMirrorClipboard";

const POLICIES = {
  /** A document that runs SvelteKit's client: our build's files and the one start-up script, by its hash. */
  script: appPolicy(`${BUILD} ${START_UP}`),
  /**
   * The fixed policy of a page that runs no client: styles, fonts and build images, and no script-src at all. It is
   * the public group's, and since book P1.22l also what an app page without the client is sent (the sign-in hop).
   */
  plain:
    `default-src 'none'; img-src ${BUILD}; style-src ${BUILD}; font-src ${ORIGIN}/fonts/; form-action 'self'; ` +
    "base-uri 'none'; frame-ancestors 'none'; object-src 'none'; manifest-src 'self'",
  /** Anything that is not a page: files, endpoints, data, redirects, refusals sent before the gate. */
  static: "default-src 'none'; frame-ancestors 'none'",
} as const;
/**
 * `none` is a 304 alone. It has no body, and server.ts takes the header off so the browser keeps the stored answer's
 * own policy (RFC 9111 section 4.3.4: a 304's headers replace the stored ones; server.ts keepStoredCsp says why).
 */
type Policy = keyof typeof POLICIES | "none";

// ---------------------------------------------------------------------------------------------------------------------
// What an answer is, as this file reads it off the bytes, and the tables that say what each answer must be.

/**
 * `page`: SvelteKit drew the route's own page (a failed form action draws it again under its 4xx).
 * `error page`: SvelteKit drew +error.svelte: a failed load, a refused action, a path no route matches.
 * `refusal page`: the gate's own page (refusal-page.ts), sent before any route ran.
 * `last-resort page`: SvelteKit's error.html, for an error outside any page.
 * `redirect`, `not modified`, and for anything else its media type.
 */
type What = "page" | "error page" | "refusal page" | "last-resort page" | "redirect" | "not modified" | (string & {});

/** One answer as the tables write it: "200 page: script". */
type Seen = `${number} ${What}: ${Policy}`;
/** What an address answers: the same to a visitor and to a member, or each named. */
type Cell = Seen | { readonly visitor: Seen; readonly member: Seen };
type Viewer = "visitor" | "member";

/**
 * A route's row. `at` is its address when the route id has a parameter. `get` is the answer to a browser's GET.
 * A page route also has `data`, its data address (`<page>/__data.json`, which SvelteKit answers for every page
 * whatever `csr` says, book P1.22h), and, when it has a +page.svelte, `client`: what its +page.ts says of `csr`. A
 * page route with no `client` has no +page.svelte: it draws nothing of its own, and its GET is the error page.
 * `state` names the browser a row needs for its page to be reached at all.
 */
type Row = {
  readonly at?: string;
  readonly state?: State;
  readonly get: Cell;
  readonly data?: Cell;
  readonly client?: boolean;
};

/**
 * `mid sign-in`: the browser holds the cookie POST /login leaves for /login/continue, visitor and member alike.
 * `at age`, `at terms`, `at chat`: the member is a new one at that step of onboarding, where only that step's page
 * is drawn (the member of every other row is past it and is sent on).
 */
type State = "mid sign-in" | "at age" | "at terms" | "at chat";

const OWNER = parseDid(`did:plc:${"a".repeat(24)}`) as Did;
const SHOWN = `did:plc:${"p".repeat(24)}`;
const NOBODY = `did:plc:${"n".repeat(24)}`;

const TO_SIGN_IN = "303 redirect: static";
const SENT_ON = "303 redirect: static";
const APP_DATA = "200 application/json: static";
const PUBLIC_DATA = "200 application/json: plain";
/** A page only a member reads, drawn with the client. */
const MEMBERS_PAGE = { visitor: TO_SIGN_IN, member: "200 page: script" } as const;

/** Every route id of the build (build/server/manifest.js). The test routes are served only with TEST_ROUTES on. */
const ROUTES: Readonly<Record<string, Row>> = {
  // Pages anyone reads.
  "/": { get: "200 page: script", data: PUBLIC_DATA, client: true },
  "/@[actor]": { at: `/@${SHOWN}`, get: "200 page: script", data: PUBLIC_DATA, client: true },
  "/legal/[document=legal]": { at: "/legal/terms", get: "200 page: script", data: PUBLIC_DATA, client: true },
  "/request-invite": { get: "200 page: script", data: PUBLIC_DATA, client: true },
  "/join": { get: "200 page: script", data: PUBLIC_DATA, client: true },

  // Signing in and out. A member has nothing to sign in to and is sent on.
  "/login": { get: { visitor: "200 page: script", member: SENT_ON }, data: APP_DATA, client: true },
  "/login/continue": { state: "mid sign-in", get: "200 page: plain", data: APP_DATA, client: false },
  "/signed-out": { get: { visitor: "200 page: script", member: SENT_ON }, data: APP_DATA, client: true },
  "/oauth/callback": { get: SENT_ON },
  "/logout": { get: "405 no content type: static" },
  "/logout/everywhere": { get: "405 no content type: static" },

  // Onboarding. /welcome only ever sends a member to their step and has no page of its own to draw; a visitor may
  // read the under-age notice.
  "/welcome": { get: SENT_ON, data: APP_DATA },
  "/welcome/age": { state: "at age", get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/welcome/terms": { state: "at terms", get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/welcome/chat": { state: "at chat", get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/welcome/blocked": { get: { visitor: "200 page: script", member: SENT_ON }, data: APP_DATA, client: true },
  "/verify-email": { get: MEMBERS_PAGE, data: APP_DATA, client: true },

  // The app's pages.
  "/[did=did]": { at: `/${OWNER}`, get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/allow": { get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/invite": { get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/notifications": { get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/notifications/sign-ins": { get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/settings/account": { get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/settings/privacy": { get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/settings/profile": { get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/settings": { get: SENT_ON },
  "/me": { get: SENT_ON },
  "/images": { get: { visitor: TO_SIGN_IN, member: "405 no content type: static" } },

  // Form targets with no screen. Two have a +page.svelte that holds a comment, because SvelteKit wants one beside
  // actions, and answer a GET 405; two have none and answer it 404. Either way the GET is the error page, which runs
  // the client like every error page (ADR 0116 point 1), whatever the route's own page would.
  "/prefs/theme": { get: "405 error page: script", data: APP_DATA, client: false },
  "/privacy-notice/seen": {
    get: { visitor: TO_SIGN_IN, member: "405 error page: script" },
    data: APP_DATA,
    client: false,
  },
  "/profile": { get: { visitor: TO_SIGN_IN, member: "404 error page: script" }, data: APP_DATA },
  "/settings/search-and-ai": { get: { visitor: TO_SIGN_IN, member: "404 error page: script" }, data: APP_DATA },

  // Files and documents for machines.
  "/[x+2e]well-known/security.txt": { at: "/.well-known/security.txt", get: "200 text/plain: static" },
  "/fonts/JetBrainsMono-Variable.woff2": { get: "200 font/woff2: static" },
  "/fonts/SpaceGrotesk-Variable.woff2": { get: "200 font/woff2: static" },
  "/health": { get: "200 application/json: static" },
  "/oauth-client-metadata.json": { get: "200 application/json: static" },
  "/oauth/jwks.json": { get: "200 application/json: static" },
  "/robots.txt": { get: "200 text/plain: static" },
  "/sitemap.xml": { get: "200 application/xml: static" },

  // The test routes (interfaces/web/src/routes/test-routes/README.md).
  "/test-routes/fails": { get: "500 last-resort page: static" },
  "/test-routes/form-post": { get: "200 page: script", data: APP_DATA, client: true },
  "/test-routes/members": { get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/test-routes/members/[key]": { at: "/test-routes/members/abc", get: MEMBERS_PAGE, data: APP_DATA, client: true },
  "/test-routes/plain-page": { get: "200 page: plain", data: PUBLIC_DATA, client: false },
  "/test-routes/waits": { get: "503 refusal page: static" },
  "/test-routes/writes/[key]": { at: "/test-routes/writes/abc", get: "200 page: script", data: APP_DATA, client: true },
};

// ---------------------------------------------------------------------------------------------------------------------
// Reading an answer.

const HASH = /'sha256-[A-Za-z0-9+/]{43}='/g;
/** Keywords that would let text become script, in any directive. `'unsafe-hashes'` is style-src-attr's, by hash. */
const NEVER = ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "'strict-dynamic'"];
/** Directives a browser would read in script-src's place (CSP3 section 6.7.1 and 6.1.14: the fallback lists). */
const SCRIPT_OVERRIDES = ["script-src-elem", "script-src-attr", "worker-src"];

/** A policy's directives, each with its sources. */
function directivesOf(header: string): Map<string, string[]> {
  const parts = header.split(";").map((part) => part.trim().split(/\s+/));
  return new Map(parts.map(([name = "", ...sources]) => [name, sources]));
}

/** The pinned policy a header is, its script-src hash read as the start-up placeholder; undefined when it is none. */
function policyOf(header: string | null): Policy | undefined {
  if (header === null) return "none";
  const placed = header
    .split("; ")
    .map((part) => (part.startsWith("script-src ") ? part.replace(HASH, START_UP) : part))
    .join("; ");
  return (Object.keys(POLICIES) as (keyof typeof POLICIES)[]).find((name) => POLICIES[name] === placed);
}

type Answer = { readonly path: string; readonly status: number; readonly headers: Headers; readonly body: string };

const isHtml = (answer: Answer): boolean => answer.headers.get("content-type")?.startsWith("text/html") === true;
/** SvelteKit drew it: the body sits in app.html's own element (interfaces/web/src/app.html). */
const kitDrew = (answer: Answer): boolean => isHtml(answer) && answer.body.includes('<div id="app">');
/** +error.svelte and the gate's refusal page both name the catalog code this way; no page does. */
const namesAnErrorCode = (answer: Answer): boolean => /<p>Error code <code>[a-z_.]+<\/code><\/p>/.test(answer.body);

function whatIs(answer: Answer): What {
  if (answer.status === 304) return "not modified";
  if (answer.status >= 300 && answer.status < 400) return "redirect";
  if (!isHtml(answer)) return answer.headers.get("content-type")?.split(";")[0]?.trim() ?? "no content type";
  if (kitDrew(answer)) return namesAnErrorCode(answer) ? "error page" : "page";
  return namesAnErrorCode(answer) ? "refusal page" : "last-resort page";
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("base64");

/**
 * The header's rules. Returns the pinned policy the answer carries and the hashes its script-src holds.
 * 1. The policy is one of the pinned values; none at all only on a 304, and never a report-only one beside it.
 * 2. Every policy starts from `default-src 'none'`, and no directive holds a keyword that lets text run.
 * 3. script-src is only on a document SvelteKit drew. It holds our build's path and at most one hash: no 'self', no
 *    other host, no scheme; and no directive stands in for it.
 */
function heldHeader(label: string, answer: Answer): { policy: Policy; hashes: readonly string[] } {
  const header = answer.headers.get("content-security-policy");
  expect(answer.headers.get("content-security-policy-report-only"), label).toBeNull();
  const policy = policyOf(header);
  if (policy === undefined) throw new Error(`${label}: a policy that is none of the pinned ones: ${header}`);
  if (header === null) {
    expect(answer.status, `${label}: no policy at all`).toBe(304);
    return { policy, hashes: [] };
  }
  const directives = directivesOf(header);
  expect(directives.get("default-src"), label).toEqual(["'none'"]);
  for (const sources of directives.values()) {
    for (const never of NEVER) expect(sources, label).not.toContain(never);
  }
  for (const name of SCRIPT_OVERRIDES) expect(directives.has(name), `${label}: ${name}`).toBe(false);
  const scripts = directives.get("script-src");
  if (scripts === undefined) return { policy, hashes: [] };
  expect(kitDrew(answer), `${label}: script-src on what SvelteKit did not draw`).toBe(true);
  const hashes = scripts.filter((source) => source !== BUILD);
  expect(hashes.length, `${label}: script-src ${scripts.join(" ")}`).toBeLessThanOrEqual(1);
  for (const hash of hashes) expect(hash, label).toMatch(new RegExp(`^${HASH.source}$`));
  return { policy, hashes };
}

/**
 * The document's rules, for any HTML.
 * 4. It has SvelteKit's start-up script exactly when its header carries a hash, and the hash is that script's. It has
 *    no other script and none with a `src`. It preloads modules only from our build, and only with the script.
 */
function heldDocument(label: string, answer: Answer, hashes: readonly string[]): void {
  const inline = inlineScripts(answer.body);
  expect(scriptCount(answer.body), `${label}: a script with a src`).toBe(inline.length);
  expect(inline.length, `${label}: scripts in the body against hashes in the header`).toBe(hashes.length);
  if (inline[0] !== undefined) {
    expect(`'sha256-${sha256(inline[0])}'`, `${label}: the start-up script's hash`).toBe(hashes[0]);
    expect(startup(answer.body), label).not.toBeNull(); // throws unless it is SvelteKit's one start-up script
  }
  const preloads = elementsOf(answer.body)
    .filter((element) => element.name === "link" && /\bmodulepreload\b/i.test(element.attributes.rel ?? ""))
    .map((link) => new URL(link.attributes.href ?? "", `${ORIGIN}${answer.path}`).href);
  if (inline.length === 0) expect(preloads, `${label}: modules preloaded with no script`).toEqual([]);
  for (const href of preloads) expect(href.startsWith(BUILD), `${label}: preloads ${href}`).toBe(true);
}

/**
 * Holds one answer to the rules every answer keeps, whatever the tables say of it, and returns it as the tables write
 * it. No answer preloads by a Link header (kit 3.2.0 output.linkHeaderPreload, off by default; we leave it off).
 */
function held(label: string, answer: Answer): Seen {
  const { policy, hashes } = heldHeader(label, answer);
  if (isHtml(answer)) heldDocument(label, answer, hashes);
  expect(answer.headers.get("link"), `${label}: a Link header`).toBeNull();
  return `${answer.status} ${whatIs(answer)}: ${policy}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The server, a visitor and the members.

const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-every-answer-test",
  max: 2,
  connectTimeoutMs: 5000,
});
const indexer = createPool({
  connection: { host: provided.host, port: provided.port, database, ...provided.roles.indexer, ssl: false },
  service: "web-every-answer-index-test",
  max: 1,
  connectTimeoutMs: 5000,
});
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only creates sessions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
const accounts = createAccountRepository(pool, {
  recordUnderageBlock: async () => {
    throw new Error("this file blocks nobody");
  },
});
// The server unseals the member's grant to read their PDS, so the test and the server use one keyring, handed over by
// file, as query-budget.test.ts does.
const KEYRING = JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } });
const keyring = parseKeyring(KEYRING);
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });
const PDS = `https://${PDS_HOST}`;
const NOW = "2026-11-23T00:00:00.000Z";

/** A signed-in browser for `did`, at the start of onboarding: a stored grant, then a session; returns the cookie. */
async function signedIn(did: Did): Promise<string> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(did, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: PDS,
      sub: did as SavedSession["tokenSet"]["sub"],
      aud: PDS,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did));
  return `__Host-sid=${created.cookieValue}`;
}

/** The cookie each member's browser sends: OWNER, past the app gate, and one new member at each step of onboarding. */
async function members(): Promise<Readonly<Record<"ready" | "at age" | "at terms" | "at chat", string>>> {
  const deadline = AbortSignal.timeout(5000);
  const fresh = (letter: string): Did => parseDid(`did:plc:${letter.repeat(24)}`) as Did;
  const ready = await signedIn(OWNER);
  await readyMember(pool, OWNER);
  const atAge = await signedIn(fresh("b"));
  const atTerms = await signedIn(fresh("c"));
  await accounts.confirmAdult(fresh("c"), deadline);
  const atChat = await signedIn(fresh("d"));
  await accounts.confirmAdult(fresh("d"), deadline);
  await accounts.acceptTerms(fresh("d"), TERMS_VERSION, PRIVACY_VERSION, deadline);
  return { ready, "at age": atAge, "at terms": atTerms, "at chat": atChat };
}

/** OWNER's DID document naming the stand-in PDS, which holds their profile (as query-budget.test.ts has it). */
function fixture(writesFile: string): StandInFixture {
  return {
    http: {
      [`https://plc.directory/${OWNER}`]: {
        body: {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id: OWNER,
          verificationMethod: [
            { id: `${OWNER}#atproto`, type: "Multikey", controller: OWNER, publicKeyMultibase: "zQ3sh" },
          ],
          service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
        },
      },
    },
    pds: {
      origin: PDS,
      did: OWNER,
      records: {
        "sh.unset.profile": { self: { $type: "sh.unset.profile", displayName: "Member One", createdAt: NOW } },
      },
      writesFile,
    },
  };
}

/** An account with a profile, as the indexer leaves one our PDS confirmed: its public page is at /@<its DID>. */
async function indexed(did: string): Promise<void> {
  const record = { $type: "sh.unset.profile", displayName: "Shown Member", createdAt: NOW };
  await withClient(indexer, null, async (c) => {
    await c.query("INSERT INTO idx.account (did, track_requested_at, updated_at) VALUES ($1, now(), now())", [did]);
    await c.query("UPDATE idx.account SET handle_status = 'unresolved', pds_active = true WHERE did = $1", [did]);
    await c.query(
      `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
       VALUES ($1, $2, 'cid-p', '3l', $3, 'Shown Member', false, now())`,
      [did, `at://${did}/sh.unset.profile/self`, record],
    );
  });
}

let web: RunningWeb;
let dir: string;
let cookies: Awaited<ReturnType<typeof members>>;
beforeAll(async () => {
  buildOnce(provided.port);
  dir = mkdtempSync(join(tmpdir(), "web-every-answer-"));
  writeFileSync(join(dir, "seal_keyring"), KEYRING);
  writeFileSync(join(dir, "writes.jsonl"), "");
  await indexed(SHOWN);
  web = await startWeb(pg, { SEAL_KEYRING_FILE: join(dir, "seal_keyring") }, fixture(join(dir, "writes.jsonl")));
  cookies = await members();
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await pool.end();
  await indexer.end();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

/** The cookie POST /login leaves for /login/continue: the authorization URL, base64url (sign-in-state.ts). */
const SIGN_IN_TARGET = `__Host-login_target=${Buffer.from(`${PDS}/oauth/authorize?request_uri=urn%3Ax`).toString("base64url")}`;

/** The Cookie header of `viewer`'s browser in `state`, or none. */
function cookieOf(viewer: Viewer, state: State | undefined): { cookie?: string } {
  const session =
    viewer === "visitor" ? [] : [cookies[state === undefined || state === "mid sign-in" ? "ready" : state]];
  const all = [...session, ...(state === "mid sign-in" ? [SIGN_IN_TARGET] : [])];
  return all.length === 0 ? {} : { cookie: all.join("; ") };
}

/**
 * A client address of its own for each request, so no two share a limit's bucket. built-server.ts's clientAddress
 * counts within one /24 and this file asks more than 254 times; these are from 198.18.0.0/15 (RFC 2544, never routed).
 */
let asked = 0;
const address = (): string => {
  asked += 1;
  return `198.18.${asked >> 8}.${asked & 255}`;
};

/** A browser's request: a document request from a client address of its own, unless `init` says other. */
type Send = (path: string, init?: WebRequest) => Promise<Answer>;
const sendAs =
  (viewer: Viewer, state: State | undefined, server: RunningWeb): Send =>
  async (path, init = {}) => {
    const headers = {
      accept: "text/html",
      "x-forwarded-for": address(),
      ...cookieOf(viewer, state),
      ...init.headers,
    };
    const response = await server.fetch(path, { ...init, headers });
    return { path, status: response.status, headers: response.headers, body: await response.text() };
  };

type Ask = (send: Send) => Promise<Answer>;

/**
 * What `ask` answers to a visitor and to a member, as the tables write it. Every answer it is sent on the way, the
 * sixty before a limit's refusal too, is held to the rules.
 */
async function cellOf(label: string, ask: Ask, state?: State, server: RunningWeb = web): Promise<Cell> {
  const as = async (viewer: Viewer): Promise<Seen> => {
    const send = sendAs(viewer, state, server);
    const holding: Send = async (path, init) => {
      const answer = await send(path, init);
      held(`${label}, a ${viewer}: ${init?.method ?? "GET"} ${path}`, answer);
      return answer;
    };
    return held(`${label}, a ${viewer}`, await ask(holding));
  };
  const visitor = await as("visitor");
  const member = await as("member");
  return visitor === member ? visitor : { visitor, member };
}

// ---------------------------------------------------------------------------------------------------------------------
// The answers that are no route's own.

/** A form post from our own page, as a browser with no script sends it. */
const form = (body: string, headers: Record<string, string> = {}): WebRequest => ({
  method: "POST",
  body,
  headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", ...headers },
});
/** What the page's script sets on the same post (`use:enhance`). */
const ENHANCED = { accept: "application/json", "x-sveltekit-action": "true" };
/** What a script's own request asks for: no document. */
const NO_DOCUMENT = { accept: "*/*" };
const APP_ROUTE = "/test-routes/form-post";
const PUBLIC_ROUTE = "/test-routes/plain-page";
/** More than /test-routes/form-post's 1 KiB maxBody. */
const TOO_LARGE = `text=${"a".repeat(2_000)}`;

/** The first file of the build under `_app/immutable/<folder>` with this ending, as its address. */
function buildFile(folder: string, ending: string): string {
  const name = readdirSync(join(WEB, "build", "client", "_app", "immutable", folder)).find((file) =>
    file.endsWith(ending),
  );
  if (name === undefined) throw new Error(`the build has no ${ending} under ${folder}`);
  return `/_app/immutable/${folder}/${name}`;
}

/**
 * The first answer to `ask` that is not a 200, asking twenty at a time: a limit's bucket refills as it is spent
 * (limits.ts: five a second for an address), so asking one by one on a slow machine might never empty it.
 */
async function firstRefusal(ask: () => Promise<Answer>): Promise<Answer> {
  for (let round = 0; round < 20; round += 1) {
    const answers = await Promise.all(Array.from({ length: 20 }, ask));
    const refused = answers.find((answer) => answer.status !== 200);
    if (refused !== undefined) return refused;
  }
  throw new Error("four hundred requests and none refused");
}

/** What one address gets for `path` once it has spent the default limit (limits.ts: sixty at once). */
const overTheLimit =
  (path: string, headers: Record<string, string> = {}): Ask =>
  (send) => {
    const from = { "x-forwarded-for": address(), ...headers };
    return firstRefusal(() => send(path, { headers: from }));
  };

/** The answer to a second GET of `path` that names the first one's ETag. */
const unchanged =
  (path: () => string): Ask =>
  async (send) => {
    const etag = (await send(path())).headers.get("etag") ?? "";
    return send(path(), { headers: { "if-none-match": etag } });
  };

const OTHERS: Readonly<Record<string, { readonly seen: Cell; readonly ask: Ask }>> = {
  // No route.
  "a path no route matches": { seen: "404 error page: script", ask: (send) => send("/no/such/page") },
  "a path no route matches, its data address": {
    seen: "404 application/json: plain",
    ask: (send) => send(`/no/such/page${DATA}`, { headers: NO_DOCUMENT }),
  },
  "a path under /_app/ that is no file": {
    seen: "404 no content type: static",
    ask: (send) => send("/_app/immutable/chunks/Gone0000.js"),
  },
  "a path that is not a path": { seen: "400 error page: script", ask: (send) => send("/%") },
  "a page's address with a slash after it": { seen: "308 redirect: static", ask: (send) => send("/legal/terms/") },

  // A load that fails: the profile of a handle nobody has, on the public page that runs the client.
  "a failed load": { seen: "404 error page: script", ask: (send) => send("/@nobody.example.com") },
  "a failed load, its data address": {
    seen: PUBLIC_DATA,
    ask: (send) => send(`/@nobody.example.com${DATA}`, { headers: NO_DOCUMENT }),
  },

  // The gate's refusals, on an app route and on a public one, to a browser's document request and to a script's.
  "405 on an app route": {
    seen: "405 refusal page: plain",
    ask: (send) => send(APP_ROUTE, { ...form("text=a"), method: "PUT" }),
  },
  "405 on an app route, no document": {
    seen: "405 text/plain: static",
    ask: (send) => send(APP_ROUTE, { ...form("text=a", NO_DOCUMENT), method: "PUT" }),
  },
  "405 on a public route": { seen: "405 refusal page: plain", ask: (send) => send(PUBLIC_ROUTE, form("text=a")) },
  "405 on a public route, no document": {
    seen: "405 text/plain: plain",
    ask: (send) => send(PUBLIC_ROUTE, form("text=a", NO_DOCUMENT)),
  },
  "413 on an app route": { seen: "413 refusal page: plain", ask: (send) => send(APP_ROUTE, form(TOO_LARGE)) },
  "413 on an app route, no document": {
    seen: "413 text/plain: static",
    ask: (send) => send(APP_ROUTE, form(TOO_LARGE, NO_DOCUMENT)),
  },
  "413 on an app route, to the page's script": {
    seen: "413 application/json: static",
    ask: (send) => send(APP_ROUTE, form(TOO_LARGE, ENHANCED)),
  },
  "415 on an app route": {
    seen: "415 refusal page: plain",
    ask: (send) => send(APP_ROUTE, form("{}", { "content-type": "application/json" })),
  },
  "429 on an app route": { seen: "429 refusal page: plain", ask: overTheLimit(APP_ROUTE) },
  "429 on an app route, no document": { seen: "429 text/plain: static", ask: overTheLimit(APP_ROUTE, NO_DOCUMENT) },
  "429 on a public route": { seen: "429 refusal page: plain", ask: overTheLimit(PUBLIC_ROUTE) },
  "429 on a public route, no document": { seen: "429 text/plain: plain", ask: overTheLimit(PUBLIC_ROUTE, NO_DOCUMENT) },
  "503 past the deadline, no document": {
    seen: "503 text/plain: static",
    ask: (send) => send("/test-routes/waits", { headers: NO_DOCUMENT }),
  },

  // Refused before the gate: SvelteKit's own check of a form post's Origin, and server.ts's host check.
  "a form post from another site": {
    seen: "403 no content type: static",
    ask: (send) => send(APP_ROUTE, form("text=a", { origin: "https://evil.test" })),
  },
  "a host that is not ours": {
    seen: "421 text/plain: static",
    ask: (send) => send(PUBLIC_ROUTE, { headers: { host: "evil.test" } }),
  },

  // Form posts a route answers.
  "a form post its page answers": { seen: "200 page: script", ask: (send) => send(APP_ROUTE, form("text=abc")) },
  "a form post its page answers, to the page's script": {
    seen: APP_DATA,
    ask: (send) => send(APP_ROUTE, form("text=abc", ENHANCED)),
  },
  // A failed action draws the route's own page again, with the page's own `csr`: not the error page.
  "a form post that fails and draws its page again": {
    seen: { visitor: TO_SIGN_IN, member: "400 page: script" },
    ask: (send) => send(`/${OWNER}?/create`, form("x=1")),
  },
  // The error page under an app route with a parameter. No GET there fails today (a GET of another account's page is
  // sent on to its public one), so it is a member's write to a page that is not their own.
  "a form post to another account's page": {
    seen: { visitor: TO_SIGN_IN, member: "404 error page: script" },
    ask: (send) => send(`/${NOBODY}?/create`, form("x=1")),
  },
  "another account's page": { seen: SENT_ON, ask: (send) => send(`/${NOBODY}`) },
  "a form post refused with the error page": {
    seen: "400 error page: script",
    ask: (send) => send("/prefs/theme", form("theme=mauve")),
  },
  "a form post that sends the browser on": { seen: SENT_ON, ask: (send) => send("/prefs/theme", form("theme=dark")) },

  // The build's files, which never pass the gate.
  "a build file: version.json": { seen: "200 application/json: static", ask: (send) => send("/_app/version.json") },
  "a build file: a script": { seen: "200 text/javascript: static", ask: (send) => send(buildFile("chunks", ".js")) },
  "a build file: the stylesheet": { seen: "200 text/css: static", ask: (send) => send(buildFile("assets", ".css")) },

  // Asked again with the first answer's ETag.
  "a public page, unchanged": { seen: "304 not modified: none", ask: unchanged(() => "/") },
  "an app page, unchanged": { seen: "304 not modified: none", ask: unchanged(() => APP_ROUTE) },
  "a build file, unchanged": { seen: "304 not modified: none", ask: unchanged(() => buildFile("chunks", ".js")) },

  // The member's own bucket, whatever their address (limits.ts `profile`: thirty writes a minute); a visitor's post is
  // sent on. Last, because it spends what every member's write above counts against.
  "429 for a member over their own limit": {
    seen: { visitor: TO_SIGN_IN, member: "429 refusal page: plain" },
    ask: (send) => firstRefusal(() => send("/test-routes/members", form("x=1"))),
  },
};

// ---------------------------------------------------------------------------------------------------------------------

type BuiltRoute = { readonly id: string; readonly page: object | null };

/** The routes of the build the server runs (kit 3.2.0 writes them to build/server/manifest.js). */
async function builtRoutes(): Promise<readonly BuiltRoute[]> {
  const { manifest } = (await import(join(WEB, "build", "server", "manifest.js"))) as {
    manifest: { routes: readonly BuiltRoute[] };
  };
  return manifest.routes;
}

/**
 * What a route file says of `csr`: true, false, nothing, or `unclear` for anything but the one plain line
 * `export const csr = true;` (another way of exporting it, a second line, or an `export *` that could carry it).
 */
function saysOfCsr(file: string): boolean | "nothing" | "unclear" {
  const source = existsSync(file) ? readFileSync(file, "utf8") : "";
  const plain = [...source.matchAll(/^export const csr = (true|false);$/gm)];
  const any = [...source.matchAll(/^\s*export\b[^\n]*(\bcsr\b|\*)/gm)];
  if (any.length === 0) return "nothing";
  return plain.length === 1 && any.length === 1 ? plain[0]?.[1] === "true" : "unclear";
}

/** One of each kind of answer, asked again with HEAD. */
const HEADS: Readonly<Record<string, () => string>> = {
  "a public page": () => "/",
  "a page that runs the client": () => APP_ROUTE,
  "a member's page": () => `/${OWNER}`,
  "a path no route matches": () => "/no/such/page",
  "a failed load": () => "/@nobody.example.com",
  "a redirect": () => "/settings",
  "an endpoint": () => "/health",
  "a build file": () => buildFile("chunks", ".js"),
  "the last-resort page": () => "/test-routes/fails",
};

// A walk asks a few hundred times in a row; beside the other files on a busy runner that passes Vitest's five seconds.
const WALK = 60_000;

describe("every answer", () => {
  test(
    "every_route_is_named_and_answers_what_its_row_says",
    async () => {
      const seen: Record<string, Row> = {};
      for (const route of await builtRoutes()) {
        const row = ROUTES[route.id];
        const at = row?.at ?? route.id;
        const dataAt = `${at === "/" ? "" : at}${DATA}`;
        const get = await cellOf(`GET ${at}`, (send) => send(at), row?.state);
        const data =
          route.page === null
            ? undefined
            : await cellOf(`GET ${dataAt}`, (send) => send(dataAt, { headers: NO_DOCUMENT }), row?.state);
        // The row as the table would write it, with what the server answered in place of what the table says.
        seen[route.id] = { ...row, get, ...(data === undefined ? {} : { data }) };
      }
      expect(seen).toEqual(ROUTES);
    },
    WALK,
  );

  test(
    "every_other_answer_is_what_the_table_says",
    async () => {
      const seen: Record<string, Cell> = {};
      for (const [name, { ask }] of Object.entries(OTHERS)) seen[name] = await cellOf(name, ask);
      expect(seen).toEqual(Object.fromEntries(Object.entries(OTHERS).map(([name, { seen: said }]) => [name, said])));
    },
    WALK,
  );

  // Production runs with TEST_ROUTES off, where a test route is the gate's refusal like any other.
  test("a_test_route_is_refused_when_test_routes_are_off", async () => {
    const off = await startWeb(pg, { TEST_ROUTES: "false" });
    try {
      const page = await cellOf("test routes off", (send) => send(PUBLIC_ROUTE), undefined, off);
      expect(page).toBe("404 refusal page: plain");
    } finally {
      await off.stop();
    }
  });

  // HTTP asks for a HEAD's header fields to be its GET's, with no content (RFC 9110 section 9.3.2). The tables ask
  // with GET, so this holds one of each kind to it: the same status, nothing to run, and the same pinned policy.
  test("a_head_answers_as_its_get_with_no_body", async () => {
    for (const [name, path] of Object.entries(HEADS)) {
      for (const viewer of ["visitor", "member"] as const) {
        const send = sendAs(viewer, undefined, web);
        const got = await send(path());
        held(`${name}, a ${viewer}: GET`, got);
        const head = await send(path(), { method: "HEAD" });
        const label = `${name}, a ${viewer}: HEAD`;
        expect(head.body, label).toBe("");
        expect(head.status, label).toBe(got.status);
        // By its pinned name: a member's start-up script, and so its hash, differs from one answer to the next.
        const policy = policyOf(head.headers.get("content-security-policy"));
        expect(policy, label).toBe(policyOf(got.headers.get("content-security-policy")));
        expect(policy, label).toBeDefined();
        expect(head.headers.get("content-security-policy-report-only"), label).toBeNull();
        expect(head.headers.get("link"), label).toBeNull();
      }
    }
  });

  // Book P1.22j, first half: a page says in its own +page.ts whether it runs SvelteKit's client, so the root layout's
  // default decides the error page alone (true since book P1.22k, ADR 0116 point 1). The table's `client` is what each
  // file says, and nothing else speaks.
  test("each_page_says_itself_whether_it_runs_the_client", async () => {
    const said: Record<string, boolean | "nothing" | "unclear"> = {};
    const drawNothing: string[] = [];
    for (const route of (await builtRoutes()).filter((one) => one.page !== null)) {
      const folder = join(SOURCE, route.id);
      said[route.id] = saysOfCsr(join(folder, "+page.ts"));
      if (!existsSync(join(folder, "+page.svelte"))) drawNothing.push(route.id);
    }
    const pages = Object.entries(ROUTES).filter(([, row]) => row.data !== undefined);
    expect(said).toEqual(Object.fromEntries(pages.map(([id, row]) => [id, row.client ?? "nothing"])));
    // Only a page route with nothing of its own to draw may say nothing.
    expect(drawNothing.sort()).toEqual(pages.flatMap(([id, row]) => (row.client === undefined ? [id] : [])).sort());

    // SvelteKit reads page options from +page, +layout and their .server files (kit docs, page options). The root
    // layout says true; no other layout and no server file says anything.
    const others = readdirSync(SOURCE, { recursive: true, encoding: "utf8" })
      .filter((file) => /(^|\/)\+(page|layout)(\.server)?\.(ts|js)$/.test(file) && !/(^|\/)\+page\.ts$/.test(file))
      .filter((file) => saysOfCsr(join(SOURCE, file)) !== "nothing");
    expect(others).toEqual(["+layout.ts"]);
    expect(saysOfCsr(join(SOURCE, "+layout.ts"))).toBe(true);

    // The table agrees with itself: a page that says true is seen running the client, and no other route's own page
    // ever is. Every error page runs it, on any route, and every row that is one says so.
    for (const [id, row] of Object.entries(ROUTES)) {
      const cells = JSON.stringify([row.get]);
      if (row.client === true) expect(cells, id).toContain("200 page: script");
      else expect(cells, id).not.toMatch(/\d+ page: script/);
    }
    const elsewhere = Object.entries(OTHERS).map(([name, { seen }]): [string, Cell] => [name, seen]);
    const rows = Object.entries(ROUTES).map(([id, row]): [string, Cell] => [id, row.get]);
    for (const [name, cell] of [...rows, ...elsewhere]) {
      for (const seen of JSON.stringify(cell).match(/\d+ error page: [^"]+/g) ?? []) {
        expect(seen, name).toMatch(/error page: script$/);
      }
    }
  });
});
