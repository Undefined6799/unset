// P2.10: the Invite page and the join page on the built web server. Postgres as `web` (TE-2). The stand-ins are what a
// test may not reach (TE-1): pds-admin, played by a loopback server that records each request and answers as told,
// and our PDS's authorization server for the sign-up's PAR (stand-in-server.ts).
import { createServer, type Server } from "node:http"; // guard-allow: egress a loopback stand-in for pds-admin only
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import {
  buildOnce,
  clientAddress,
  ORIGIN,
  PDS_HOST,
  type RunningWeb,
  type StandInFixture,
  startWeb,
} from "../built-server.ts";
import { DATA, dataAnswer, inlineScripts, nodeData, startupData } from "../data-address.ts";
import { readyMember } from "../members.ts";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-invite-test",
  max: 2,
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
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 3).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });
const PDS = `https://${PDS_HOST}`;

let dids = 0;
function nextDid(): Did {
  dids += 1;
  const tail = dids.toString(32).replace(/[0189]/g, (d) => "wxyz"["0189".indexOf(d)] ?? "a");
  const parsed = parseDid(`did:plc:${tail.padStart(24, "n")}`);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
}

/**
 * A signed-in member, by default onboarded with a confirmed email (`ready`); "new" has not onboarded, "unconfirmed" has
 * but its email is not confirmed. Returns the DID and the session cookie.
 */
async function signedIn(stage: "ready" | "new" | "unconfirmed" = "ready"): Promise<{ did: Did; cookie: string }> {
  const did = nextDid();
  await tokenSets.set(did, {
    dpopJwk: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d", kid: "dpop", alg: "ES256" } as SavedSession["dpopJwk"],
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
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did, { issuerOrigin: PDS }));
  if (stage !== "new") await readyMember(pool, did, stage === "ready");
  return { did, cookie: `__Host-sid=${created.cookieValue}` };
}

/** pds-admin as web sees it: every request body it received, and the answer it gives next. */
type Answer = { status: number; body: unknown };
const received: Record<string, unknown>[] = [];
let answer: Answer = { status: 200, body: { code: "pds-test-abcde-fghij", remaining: 4, availableAt: null } };
let issued = 0;
const pdsAdmin: Server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    received.push({ path: req.url, ...(JSON.parse(Buffer.concat(chunks).toString("utf8")) as object) });
    issued += 1;
    const body = answer.status === 200 ? { ...(answer.body as object), code: `pds-test-code-${issued}` } : answer.body;
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
});

/** Our PDS's discovery and PAR, enough for the sign-up to reach /login/continue. */
const STAND_INS: StandInFixture = {
  fetch: {
    [`GET ${PDS}/.well-known/oauth-protected-resource`]: { body: { resource: PDS, authorization_servers: [PDS] } },
    [`GET ${PDS}/.well-known/oauth-authorization-server`]: {
      body: {
        issuer: PDS,
        authorization_endpoint: `${PDS}/oauth/authorize`,
        token_endpoint: `${PDS}/oauth/token`,
        pushed_authorization_request_endpoint: `${PDS}/oauth/par`,
        require_pushed_authorization_requests: true,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        token_endpoint_auth_signing_alg_values_supported: ["ES256"],
        dpop_signing_alg_values_supported: ["ES256"],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        scopes_supported: ["atproto"],
      },
    },
    [`POST ${PDS}/oauth/par`]: {
      status: 201,
      body: { request_uri: "urn:ietf:params:oauth:request_uri:req-join", expires_in: 299 },
    },
  },
};

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  await new Promise<void>((done) => pdsAdmin.listen(0, "127.0.0.1", done));
  const address = pdsAdmin.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  web = await startWeb(
    pg,
    // pds-admin's policy is internal: its one origin, private or loopback answers only (net-guard resolve.ts).
    { PDS_ADMIN_URL: `http://127.0.0.1:${port}` },
    STAND_INS,
  );
}, 120_000);
beforeEach(() => {
  received.length = 0;
  answer = { status: 200, body: { code: "unused", remaining: 4, availableAt: null } };
});
afterAll(async () => {
  await web?.stop();
  await new Promise((done) => pdsAdmin.close(done));
  await pool.end();
});

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const post = (path: string, body: string, cookie?: string, origin = ORIGIN) =>
  web.fetch(path, {
    method: "POST",
    body,
    headers: {
      "x-forwarded-for": clientAddress(),
      origin,
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie === undefined ? {} : { cookie }),
    },
  });
const get = (path: string, cookie?: string) =>
  web.fetch(path, { headers: { "x-forwarded-for": clientAddress(), ...(cookie === undefined ? {} : { cookie }) } });

/** The submission id the page rendered into the invite form. */
async function submissionOf(cookie: string): Promise<string> {
  const html = await (await get("/invite", cookie)).text();
  const found = /name="submissionId" value="([0-9a-f-]{36})"/.exec(html)?.[1];
  if (found === undefined) throw new Error("no submission id on the page");
  return found;
}

describe("the Invite page", () => {
  test("invite.requires_session: a visitor goes to sign in", async () => {
    const response = await get("/invite");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Finvite");
  });

  test("invite.cross_site: a POST from another site is refused and asks pds-admin nothing", async () => {
    const { cookie } = await signedIn();
    const fields = form({ submissionId: await submissionOf(cookie), countryAck: "yes" });
    expect((await post("/invite?/issue", fields, cookie, "https://evil.test")).status).toBe(403);
    expect(received).toHaveLength(0);
  });

  test("invite.gate: a member who has not onboarded, or whose email is unconfirmed, cannot ask for one", async () => {
    for (const stage of ["new", "unconfirmed"] as const) {
      const { cookie } = await signedIn(stage);
      const fields = form({ submissionId: crypto.randomUUID(), countryAck: "yes" });
      const response = await post("/invite?/issue", fields, cookie);
      expect(response.status, stage).toBe(303);
      expect(response.headers.get("location"), stage).not.toMatch(/^\/invite/);
      expect((await get("/invite", cookie)).status, stage).toBe(303);
    }
    expect(received).toHaveLength(0);
  });

  test("invite.issue_ok: one signed request for the member, then the join link is listed", async () => {
    const { did, cookie } = await signedIn();
    const response = await post(
      "/invite?/issue",
      form({ submissionId: await submissionOf(cookie), countryAck: "yes" }),
      cookie,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/invite?left=4");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      path: "/v1/invite.issue",
      kid: "web-test",
      payload: { verb: "invite.issue", target: did, actor_did: did, env: "dev", pds_did: `did:web:${PDS_HOST}` },
    });
    const page = await (await get("/invite?left=4", cookie)).text();
    expect(page).toMatch(/value="https:\/\/unset\.test\/join\?invite=pds-test-code-\d+"/);
    expect(page).toContain("4 invites left in the next 24 hours.");
    // The page says how long our app shows the code (Alex 2026-11-19: 7 days), no more than that.
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    expect([day(7), day(8)].some((date) => page.includes(`Shown here until <time datetime="${date}`))).toBe(true);
  });

  test("invite.double_submit: the same form sent twice is one request and one invite", async () => {
    const { cookie } = await signedIn();
    const body = form({ submissionId: await submissionOf(cookie), countryAck: "yes" });
    expect((await post("/invite?/issue", body, cookie)).status).toBe(303);
    const again = await post("/invite?/issue", body, cookie);
    expect(again.headers.get("location")).toBe("/invite");
    expect(received).toHaveLength(1);
    const page = await (await get("/invite", cookie)).text();
    // One field per invite (the page's data, which the client reads, names the link again).
    expect(page.match(/value="https:\/\/unset\.test\/join\?invite=/g)).toHaveLength(1);
  });

  test("invite.country_ack_required: no request without the tick while the rule is on", async () => {
    const { cookie } = await signedIn();
    const response = await post("/invite?/issue", form({ submissionId: await submissionOf(cookie) }), cookie);
    expect(response.headers.get("location")).toBe("/invite?error=invite.country_ack_required");
    expect(received).toHaveLength(0);
  });

  test("invite.bad_submission: a form without a valid submission id asks for nothing", async () => {
    const { cookie } = await signedIn();
    const response = await post("/invite?/issue", form({ submissionId: "not-a-uuid", countryAck: "yes" }), cookie);
    expect(response.headers.get("location")).toBe("/invite?error=invite.bad_submission");
    expect(received).toHaveLength(0);
  });

  test.each([
    [429, { error: "quota", availableAt: "2026-11-20T00:00:00.000Z" }, "invite.quota"],
    [409, { error: "signups_closed" }, "invite.closed"],
    [403, { error: "denied" }, "invite.denied"],
    [503, { error: "unavailable" }, "invite.unavailable"],
  ])("invite.refused: pds-admin %i is shown as %s and the form can be sent again", async (status, body, code) => {
    const { cookie } = await signedIn();
    answer = { status, body };
    const fields = form({ submissionId: await submissionOf(cookie), countryAck: "yes" });
    expect((await post("/invite?/issue", fields, cookie)).headers.get("location")).toBe(`/invite?error=${code}`);
    answer = { status: 200, body: { code: "unused", remaining: 3, availableAt: null } };
    expect((await post("/invite?/issue", fields, cookie)).headers.get("location")).toBe("/invite?left=3");
  });

  test("invite.hide_own_only: a member hides their own invite and cannot touch another's", async () => {
    const alice = await signedIn();
    const bob = await signedIn();
    await post("/invite?/issue", form({ submissionId: await submissionOf(bob.cookie), countryAck: "yes" }), bob.cookie);
    const [bobs] = await withClient(
      pool,
      null,
      async (db) =>
        (await db.query<{ id: string }>("SELECT id FROM app.invite WHERE inviter_did = $1", [bob.did])).rows,
    );
    const refused = await post("/invite?/hide", form({ id: bobs?.id ?? "" }), alice.cookie);
    expect(refused.headers.get("location")).toBe("/invite");
    expect(await (await get("/invite", bob.cookie)).text()).toContain("join?invite=");
    expect((await post("/invite?/hide", form({ id: bobs?.id ?? "" }), bob.cookie)).status).toBe(303);
    expect(await (await get("/invite", bob.cookie)).text()).not.toContain("join?invite=");
  });
});

describe("the join page", () => {
  test("join.renders_code: anyone sees the code, with no Referer, never stored", async () => {
    const response = await get("/join?invite=pds-test-abcde-fghij");
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const html = await response.text();
    expect(html).toContain('value="pds-test-abcde-fghij"');
    expect(html).toContain("Create account");
  });

  // Book P1.22l (ADR 0116): the join page runs SvelteKit's client under the app group's script policy. The code is a
  // credential the page shows, so it is in the page's start-up script as it is in its markup, and that document is
  // never stored and sends no Referer, so no request for a build file carries the address.
  test("join.runs_client: only our client, and its data is what the page draws", async () => {
    const response = await get("/join?invite=pds-test-abcde-fghij");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`script-src ${ORIGIN}/_app/ 'sha256-`);
    expect(csp).not.toContain("unsafe-inline");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const drawn = {
      code: "pds-test-abcde-fghij",
      malformed: false,
      signedIn: false,
      pdsHost: PDS_HOST,
      countryRule: expect.any(Boolean),
    };
    expect(startupData(await response.text(), 1)).toEqual(drawn);
    const data = await get(`/join${DATA}?invite=pds-test-abcde-fghij`);
    expect(data.headers.get("content-security-policy")).not.toContain("script-src");
    expect(data.headers.get("cache-control")).toContain("no-store");
    expect(nodeData(await dataAnswer(data), 1)).toEqual(drawn);
  });

  // The Threats of book P1.22l. SvelteKit hashes the start-up script it writes, so the policy allows whatever the
  // server put there. The load returns the invite only as a code (letters, digits and dashes, rule DM-1) and
  // otherwise a flag, so whatever a link's author typed, the script is one of two the server would write anyway.
  test("join.query_is_a_code_or_a_flag: nothing else a link says reaches the start-up script", async () => {
    const none = inlineScripts(await (await get("/join")).text());
    const broken = inlineScripts(await (await get("/join?invite=not%20a%20code")).text());
    expect(broken).not.toEqual(none);
    const values = [
      "</script><script>alert(1)</script>",
      "<!--<script>",
      "javascript:alert(1)",
      "pds-test\u2028abcde",
      'pds-test"-abcde',
      `pds-${"a".repeat(80)}`,
    ];
    for (const value of values) {
      const html = await (await get(`/join?invite=${encodeURIComponent(value)}`)).text();
      expect(inlineScripts(html), value).toEqual(broken);
      expect(startupData(html, 1), value).toMatchObject({ code: null, malformed: true });
    }
    for (const name of ["error", "next", "code", "handle", "sent"]) {
      const html = await (await get(`/join?${name}=${encodeURIComponent(values[0] ?? "")}`)).text();
      expect(inlineScripts(html), name).toEqual(none);
    }
  });

  test("join.code_malformed: a value that is not a code is never echoed", async () => {
    const html = await (await get(`/join?invite=${encodeURIComponent("<script>x</script>")}`)).text();
    expect(html).toContain("This invite link looks broken");
    expect(html).not.toContain("<script>x");
  });

  test("join.code_not_logged: the request log names the route, never the code", async () => {
    await get("/join?invite=pds-secret-code-zzzzz");
    expect(JSON.stringify(web.logs())).not.toContain("pds-secret-code-zzzzz");
  });

  test("join.signed_in: a member is told the invite is for someone else, and no sign-up starts", async () => {
    const { cookie } = await signedIn();
    const html = await (await get("/join?invite=pds-test-abcde-fghij", cookie)).text();
    expect(html).toContain("this invite is for someone else");
    expect(html).not.toContain("Create account");
    expect((await post("/join", "", cookie)).headers.get("location")).toBe("/me");
  });

  test("join.starts_sign_up: Create account sends the browser on to our PDS", async () => {
    const before = web.standInCalls().length;
    const response = await post("/join", "");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login/continue");
    expect(web.standInCalls().slice(before)).toContain(`POST ${PDS}/oauth/par`);
  });
});
