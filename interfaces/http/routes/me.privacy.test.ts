// P1.25m (routes/me.ts; architecture's #975 ruling, D-5 conditions 1 to 3): the DID-addressed account keeps its DID
// out of the logs, sends the same-origin referrer policy, is matched only after every explicit route, and answers a
// foreign DID exactly as it answers a path that is no account. Condition 4 (owner only) is me.test.ts's.
// P1.25n: the signed-out and log cases also run on the composed server, so the real app gate answers them; signed in
// needs a stored session, so those cases keep the gate double.
// The edge's side of condition 1 is edge.image.test.ts's edge_all_logs_have_no_ip_path_or_query: its access log keeps
// a route class, never the path, and that test sends a path holding a DID.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import type { Did } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import { compose } from "../compose.ts";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { pageResponse } from "../web/page.ts";
import { meRoutes } from "./me.ts";

const ORIGIN = "https://unset.test";
const OWNER = `did:plc:${"a".repeat(24)}` as Did;
const FOREIGN = `did:plc:${"b".repeat(24)}` as Did;
const SESSION: Session = { did: OWNER, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const TESTDATA = fileURLToPath(new URL("../web/testdata/", import.meta.url));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN, WEB_BUILD_DIR: TESTDATA }));

const INVALID = [
  "/nowhere",
  "/DID:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
  "/did:plc:short",
  "/did%253Aplc%253Aaaaaaaaaaaaaaaaaaaaaaaaa",
];

type Server = { request: (request: Request, peer?: string) => Promise<Response> };
const get = (on: Server, path: string, cookie?: string) =>
  on.request(
    new Request(`${ORIGIN}${path}`, {
      headers: { host: "unset.test", "x-forwarded-for": "192.0.2.1", ...(cookie ? { cookie } : {}) },
    }),
    "10.0.0.1",
  );

/** The account routes on a kit server with a gate double (signed in as OWNER unless `signedOut`), and its log. */
function accountServer(signedOut = false) {
  const lines: string[] = [];
  const resolved: string[] = [];
  const log = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: (line) => lines.push(line) });
  const routes = meRoutes({
    open: async (_request, _deadline, next) =>
      signedOut
        ? new Response(null, { status: 303, headers: { location: `/login?${new URLSearchParams({ next })}` } })
        : { session: SESSION, privacyNotice: false },
    verifyHandle: async (did) => {
      resolved.push(did);
      return { status: "verified", handle: "alice.pds.unset.test" as never, checkedAt: 0 };
    },
    page: (page) =>
      pageResponse(
        {
          build: { manifest: { boot: "assets/boot.js", styles: [], fonts: [], islands: new Map() }, files: new Map() },
          render: web.renderPage,
          assetsOrigin: ORIGIN,
          env: "test",
          log,
        },
        page,
      ),
    screens: web.screens,
    pdsHost: "pds.unset.test",
  });
  return { server: createServer({ config: CONFIG, routes, policies, log }), lines, resolved };
}

/**
 * The composed server (the real app gate), with every line its logger writes to stdout captured. The logger takes no
 * writer through compose, so stdout, an unmanaged dependency, is the seam; it is restored after each request.
 */
async function composedServer() {
  const lines: string[] = [];
  const { server } = await compose(CONFIG, web);
  const request = async (request: Request, peer?: string) => {
    const write = process.stdout.write;
    process.stdout.write = ((line: string) => lines.push(line) > 0) as typeof process.stdout.write;
    try {
      return await server.request(request, peer);
    } finally {
      process.stdout.write = write;
    }
  };
  return { server: { request }, lines };
}

/** A response's whole shape but its date, which moves with the clock. */
const shape = async (response: Response) => ({
  status: response.status,
  headers: [...response.headers].filter(([name]) => name !== "date"),
  body: await response.text(),
});

describe("DID account privacy", () => {
  test("did_route_logs_no_did", async () => {
    const signedIn = accountServer();
    const signedOut = accountServer(true);
    const composed = await composedServer();
    // Percent-escapes are case-insensitive (RFC 3986 2.1), so a client may send the DID's colons in either case.
    const encoded = (did: string, hex: string) => did.replaceAll(":", hex);
    const paths = [
      `/${OWNER}`,
      `/${FOREIGN}`,
      "/me",
      "/did",
      "/did:web:example.com",
      `/${OWNER}?x=${OWNER}`,
      `/${encoded(OWNER, "%3a")}`,
      `/${encoded(OWNER, "%3A")}`,
      `/did%3aplc:${"a".repeat(24)}`,
      `/${encoded(FOREIGN, "%3a")}`,
    ];
    for (const path of paths) {
      await get(signedIn.server, path, "__Host-sid=x");
      await get(signedOut.server, path);
      await get(composed.server, path);
      await get(composed.server, path, "__Host-sid=x");
    }
    const lines = [...signedIn.lines, ...signedOut.lines, ...composed.lines];
    expect(composed.lines.some((line) => line.includes('"event":"http.request"'))).toBe(true);
    expect(signedIn.lines.some((line) => line.includes('"event":"http.request"'))).toBe(true);
    for (const line of lines) {
      expect(line).not.toMatch(/did(?::|%3a)(?:plc|web)/i);
      // SE-7: the handle the page resolved and the client and peer addresses stay out too.
      expect(line).not.toContain("alice.pds.unset.test");
      expect(line).not.toContain("192.0.2.1");
      expect(line).not.toContain("10.0.0.1");
    }
  });

  test("did_route_referrer_same_origin", async () => {
    const { server } = accountServer();
    for (const path of [`/${OWNER}`, `/${FOREIGN}`, "/me", "/did"]) {
      const response = await get(server, path, "__Host-sid=x");
      expect(response.headers.get("referrer-policy"), path).toBe("same-origin");
      // A <meta name="referrer"> sets the policy from markup, and the latest source wins (W3C Referrer Policy, 4.2 and
      // 11.1), so a page-level policy could replace the header's: the page carries none.
      const html = await response.text();
      expect(html, path).not.toMatch(/<meta[^>]*name="?referrer/i);
      expect(html, path).not.toMatch(/referrerpolicy/i);
    }
  });

  test("foreign_did_reads_as_missing", async () => {
    const { server, resolved } = accountServer();
    const foreign = await get(server, `/${FOREIGN}`, "__Host-sid=x");
    const missing = await get(server, `/did:plc:${"c".repeat(24)}`, "__Host-sid=x");
    const a = await shape(foreign);
    expect(a.status).toBe(404);
    expect(await shape(missing)).toEqual(a);
    // The strict cases of me.test.ts read the same: no second percent-decoding, no other casing. A did:web with a path
    // cannot fail here (the session is did:plc, so it reads as foreign either way); me.test.ts pins it.
    for (const path of INVALID) expect(await shape(await get(server, path, "__Host-sid=x")), path).toEqual(a);
    // Nothing about another DID is looked up, so the answer cannot depend on whether it exists.
    expect(resolved).toEqual([]);
  });

  test("signed_out_did_answers_alike", async () => {
    // The real app gate: whether a DID has an account here must not change a signed-out answer in any way.
    const { server } = await composedServer();
    const answer = async (did: Did, cookie?: string) => {
      const response = await get(server, `/${did}`, cookie);
      // Only the return path names the DID; the rest must match byte for byte.
      expect(response.headers.get("location"), did).toBe(`/login?${new URLSearchParams({ next: `/${did}` })}`);
      const { headers, ...rest } = await shape(response);
      return { ...rest, headers: headers.filter(([name]) => name !== "location") };
    };
    const own = await answer(OWNER);
    expect(own.status).toBe(303);
    expect(await answer(FOREIGN)).toEqual(own);
    expect(await answer(`did:plc:${"c".repeat(24)}` as Did)).toEqual(own);
    // A cookie that names no session is signed out too, and answers alike for any DID.
    const dead = await answer(OWNER, "__Host-sid=x");
    expect(await answer(FOREIGN, "__Host-sid=x")).toEqual(dead);
  });

  test("did_route_registered_after_every_explicit_route", async () => {
    const { server } = await compose(CONFIG, web);
    const table = server.routeTable().filter((route) => route.method === "GET");
    expect(table.at(-1)?.path).toBe("/:did");
    // Each explicit one-segment page still answers from its own route: the DID route would 404 a path that is no DID.
    const explicit = table
      .map((route) => route.path)
      .filter((path) => path !== "/:did" && path !== "/" && path.split("/").length === 2);
    expect(explicit.length).toBeGreaterThan(5);
    for (const path of explicit) expect((await get(server, path)).status, path).not.toBe(404);
  });
});
