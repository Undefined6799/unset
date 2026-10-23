// P2.13 (routes/me.ts): the DID-addressed profile page. The session store and handle check are P2.03's and P2.02's, tested
// against Postgres and a stand-in network in their own suites; here they return each case the page handles.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as web from "@unset/apps-web";
import type { Did, HandleVerdict } from "@unset/domains-identity";
import type { ProfileFields } from "@unset/domains-profile";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { parse } from "parse5";
import { afterAll, describe, expect, test } from "vitest";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { sessionClearCookie } from "../session-cookie.ts";
import { webTestEnv } from "../test-env.ts";
import { elements, textContent } from "../web/fixtures/html.ts";
import { pageResponse } from "../web/page.ts";
import { type MeDeps, meRoutes } from "./me.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const ACCOUNT_PATH = `/${DID}`;
const SESSION: Session = { did: DID, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

type World = {
  session?: Session | null;
  clearCookie?: boolean;
  verdict?: HandleVerdict;
  /** What the member's PDS holds; absent means no profile yet. */
  profile?: ProfileFields | null | "unavailable";
};

const ALICE: ProfileFields = {
  displayName: "Alice Moreau",
  headline: "Designer and front-end developer.",
  location: "Toronto, Ontario",
  website: "https://alice.example/",
  readme: "## About me\nI make **small** tools.\n:::\n## My projects\n- [Tidy](https://alice.example/tidy)",
};

function setup(world: World = {}) {
  const checked: string[] = [];
  const loaded: string[] = [];
  const openedPaths: string[] = [];
  const log = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
  const deps: MeDeps = {
    open: async (_request, _deadline, next) => {
      openedPaths.push(next);
      const session = world.session === undefined ? SESSION : world.session;
      if (session === null) {
        const headers = new Headers({
          location: `/login?${new URLSearchParams({ next })}`,
          "cache-control": "no-store",
        });
        if (world.clearCookie) headers.append("set-cookie", sessionClearCookie());
        return new Response(null, { status: 303, headers });
      }
      return { session, privacyNotice: false };
    },
    verifyHandle: async (did) => {
      checked.push(did);
      return world.verdict ?? { status: "verified", handle: "alice.pds.unset.test" as never, checkedAt: 0 };
    },
    page: (page) =>
      pageResponse(
        {
          build: {
            manifest: {
              boot: "assets/boot.js",
              styles: [],
              fonts: [],
              icons: { favicon: "assets/icon.png", appleTouch: "assets/touch.png" },
              islands: new Map(),
            },
            files: new Map(),
          },
          render: web.renderPage,
          assetsOrigin: ORIGIN,
          env: "test",
          log,
        },
        page,
      ),
    screens: web.screens,
    loadProfile: async (did) => {
      loaded.push(did);
      return world.profile === undefined ? null : world.profile;
    },
  };
  const server = createServer({ config: CONFIG, routes: meRoutes(deps), policies, log });
  const get = (path = ACCOUNT_PATH) =>
    server.request(
      new Request(`${ORIGIN}${path}`, {
        headers: { host: "unset.test", "x-forwarded-for": "192.0.2.1", cookie: "__Host-sid=x" },
      }),
      "10.0.0.1",
    );
  return { get, checked, loaded, openedPaths };
}

describe("GET /:did", () => {
  test("me_renders_the_signed_in_account", async () => {
    const { get, checked, loaded } = setup();
    const response = await get();
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("alice.pds.unset.test");
    const document = parse(html);
    expect(elements(document, "main", { id: "main" })).toHaveLength(1);
    expect(html).toContain("Skip to content");
    const account = elements(elements(document, "nav")[0], "a", { href: ACCOUNT_PATH, "aria-current": "page" })[0];
    expect(account).toBeDefined();
    const initials = elements(account, "span", { "aria-hidden": "true" }).map(textContent);
    expect(initials).toContain("A");
    // P2.13e: the only script is the island boot and the drawer's theme-picker props.
    expect(elements(document, "script").map((script) => script.attrs?.find((a) => a.name === "type")?.value)).toEqual([
      "application/json",
      "module",
    ]);
    expect(checked).toEqual([DID]);
    expect(loaded).toEqual([DID]);
  });

  test("me_renders_the_published_profile", async () => {
    const html = await (await setup({ profile: ALICE }).get()).text();
    const main = elements(parse(html), "main")[0];
    expect(elements(main, "h1").map(textContent)).toEqual(["Alice Moreau"]);
    expect(textContent(main)).toContain("alice.pds.unset.test");
    expect(textContent(main)).toContain("Designer and front-end developer.");
    expect(textContent(main)).toContain("Toronto, Ontario");
    const website = elements(main, "a", { href: "https://alice.example/" })[0];
    expect(website && textContent(website)).toBe("alice.example");
    expect(website?.attrs?.find((a) => a.name === "rel")?.value).toBe("nofollow ugc noopener noreferrer me");
    expect(elements(main, "h2").map(textContent)).toEqual(["About me", "My projects"]);
    expect(elements(main, "strong").map(textContent)).toEqual(["small"]);
    expect(elements(main, "a", { href: "/settings/profile" })).toEqual([]);
  });

  test("me_with_an_unavailable_profile_still_renders", async () => {
    const response = await setup({ profile: "unavailable" }).get();
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("We could not load your profile just now.");
    expect(html).toContain("alice.pds.unset.test");
  });

  test("me.renders_owner_data", async () => {
    // P2.13c: the initials avatar, the neutral state and the call to action, until P2.18/P2.22 bring the real ones.
    const html = await (await setup().get()).text();
    const main = elements(parse(html), "main")[0];
    expect(elements(main, "a", { href: "/settings/profile" }).map(textContent)).toEqual(["Edit profile"]);
    expect(textContent(main)).toContain("Set up your profile");
    expect(textContent(main)).toContain("Not set up yet");
    expect(elements(main, "span", { "aria-hidden": "true" }).map(textContent)).toContain("A");
    expect(html).not.toContain("getBlob");
    // The account details moved to Settings › Account (P2.13c), so the PDS host is not linked here.
    expect(html).not.toContain('href="https://pds.unset.test');
  });

  test("me_no_cache", async () => {
    const response = await setup().get();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  test("me_handle_unavailable", async () => {
    const html = await (await setup({ verdict: { status: "unavailable" } }).get()).text();
    expect(html).toContain("handle.invalid");
    expect(html).toContain("We could not check your handle just now");
  });

  test("me_handle_invalid", async () => {
    const html = await (await setup({ verdict: { status: "invalid", checkedAt: 0 } }).get()).text();
    expect(html).toContain("handle.invalid");
    expect(html).not.toContain("could not check");
    const account = elements(elements(parse(html), "nav")[0], "a", { href: ACCOUNT_PATH, "aria-current": "page" })[0];
    expect(account).toBeDefined();
    const initials = elements(account, "span", { "aria-hidden": "true" }).map(textContent);
    expect(initials).not.toContain("H");
  });

  test("me_clears_a_dead_session_cookie", async () => {
    const response = await setup({ session: null, clearCookie: true }).get();
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toContain("__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  test("me_guards_signed_out", async () => {
    const { get, checked, loaded } = setup({ session: null });
    const response = await get();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/login?${new URLSearchParams({ next: ACCOUNT_PATH })}`);
    expect(checked).toEqual([]);
    expect(loaded).toEqual([]);
  });

  test.each([
    "/nowhere",
    "/DID:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
    "/did:plc:short",
    "/did:web:example.com%2Fevil",
    "/did%253Aplc%253Aaaaaaaaaaaaaaaaaaaaaaaaa",
  ])("invalid DID %s never opens a session or resolves an identity", async (path) => {
    const { get, checked, openedPaths } = setup();
    expect((await get(path)).status).toBe(404);
    expect(openedPaths).toEqual([]);
    expect(checked).toEqual([]);
  });

  test("another DID cannot expose the caller's account controls or resolve the target", async () => {
    const { get, checked, loaded } = setup({ profile: ALICE });
    const response = await get(`/did:plc:${"b".repeat(24)}`);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).not.toContain(DID);
    expect(html).not.toContain("alice.pds.unset.test");
    expect(html).not.toContain("Alice Moreau");
    expect(checked).toEqual([]);
    expect(loaded).toEqual([]);
  });

  test("a supported did:web is scoped to its owner", async () => {
    const did = "did:web:example.com" as Did;
    const { get, checked } = setup({ session: { ...SESSION, did } });
    const response = await get(`/${did}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("alice.pds.unset.test");
    expect(checked).toEqual([did]);
  });
});

describe.each(["/did", "/me"])("self-profile shortcut %s", (path) => {
  test("redirects to the session DID without a handle lookup", async () => {
    const { get, checked, openedPaths } = setup();
    const response = await get(path);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(ACCOUNT_PATH);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(openedPaths).toEqual(["/did"]);
    expect(checked).toEqual([]);
  });

  test("preserves the app gates and resumes through /did", async () => {
    const { get, checked } = setup({ session: null, clearCookie: true });
    const response = await get(path);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fdid");
    expect(response.headers.getSetCookie()).toContain("__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
    expect(checked).toEqual([]);
  });
});
