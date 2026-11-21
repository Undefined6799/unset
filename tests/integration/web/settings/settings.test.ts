// P1.20h: the settings pages and the profile save on the built web server, the outcomes interfaces/http's
// settings.test.ts and profile.test.ts check (the account view and the save's decisions are unit-tested beside their
// files). Postgres as `web` (TE-2). A session is planted as gate.test.ts plants one; P1.20e's tests sign in for real.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { join, relative } from "node:path";
import { type Did, PRIVACY_VERSION, parseDid, TERMS_VERSION } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import {
  createAccountRepository,
  createOAuthSessionStore,
  createPool,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { parse } from "parse5";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { chatAccountsOf } from "../../../support/chat-accounts.ts";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, type StandInFixture, startWeb } from "../built-server.ts";
import { elements, textContent } from "../html.ts";
import { readyMember } from "../members.ts";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };

const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-settings-test",
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
const ISSUER = "https://pds.unset.test";
const accounts = createAccountRepository(pool, {
  recordUnderageBlock: async () => {
    throw new Error("this file never blocks");
  },
  chatAccounts: chatAccountsOf(pool),
});
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });

function did(text: string): Did {
  const parsed = parseDid(text);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
}

let dids = 0;
/** A new DID per call, so two tests never share a member's limit. */
function nextDid(): Did {
  dids += 1;
  const parsed = parseDid(
    `did:plc:${dids
      .toString(32)
      .replace(/[0189]/g, (d) => "wxyz"["0189".indexOf(d)] ?? "a")
      .padStart(24, "a")}`,
  );
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
}

/** A signed-in browser for a new member, its session carrying our PDS's origin; returns the DID and the cookie. */
async function signedIn(did: Did = nextDid(), issuerOrigin: string = ISSUER): Promise<{ did: Did; cookie: string }> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(did, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: ISSUER,
      sub: did as SavedSession["tokenSet"]["sub"],
      aud: ISSUER,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did, { issuerOrigin }));
  await readyMember(pool, did);
  return { did, cookie: `__Host-sid=${created.cookieValue}` };
}

/** A member whose DID document the directory cannot serve just now. */
const UNREACHABLE = did("did:plc:unreachableunreachableun");
const STAND_INS: StandInFixture = {
  http: {
    [`https://plc.directory/${UNREACHABLE}`]: { status: 503, body: "unavailable" },
  },
};

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  web = await startWeb(pg, {}, STAND_INS);
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await pool.end();
});

const get = (path: string, cookie?: string) =>
  web.fetch(path, { headers: { "x-forwarded-for": clientAddress(), ...(cookie ? { cookie } : {}) } });

/** A form post to /profile from our own origin, unless `crossSite`. */
const postProfile = (
  body: string,
  init: { cookie?: string; crossSite?: boolean; from?: string; accept?: string } = {},
) =>
  web.fetch("/profile", {
    method: "POST",
    body,
    headers: {
      origin: init.crossSite ? "https://evil.test" : ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
      // A browser's plain form post; without it SvelteKit answers as to its enhanced client, in JSON (kit 3.2.0
      // runtime/server/page/actions.js is_action_json_request).
      accept: init.accept ?? "text/html",
      "x-forwarded-for": init.from ?? clientAddress(),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
  });

/** The settings side list's links, each with whether it is marked as the current page. */
function sideList(html: string): { href: string; current: boolean }[] {
  const nav = elements(parse(html), "nav", { "aria-label": "Settings" })[0];
  return elements(nav, "a").map((a) => ({
    href: a.attrs?.find((attr) => attr.name === "href")?.value ?? "",
    current: (a.attrs ?? []).some((attr) => attr.name === "aria-current" && attr.value === "page"),
  }));
}

describe("GET /settings", () => {
  test("settings.redirect", async () => {
    const response = await get("/settings?error=logout.confirm_required");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings/profile?error=logout.confirm_required");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  test("settings.redirect without a query", async () => {
    expect((await get("/settings")).headers.get("location")).toBe("/settings/profile");
  });
});

describe("GET /settings/profile", () => {
  // The page reads the member's profile from their PDS; this file stands in none, so the grant cannot be restored and
  // the member is sent to sign in again, as on their own page. profile-save.test.ts checks the page on a stand-in PDS.
  test("settings_profile_with_a_dead_grant_goes_to_sign_in", async () => {
    const { cookie } = await signedIn();
    const response = await get("/settings/profile", cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=login.session_ended");
  });
});

describe("the privacy notice banner", () => {
  // The shell draws it (P2.12b), so every app page shows it; onboarding.test.ts checks the dismiss.
  test.each(["/settings/account"])("%s shows it once the notice changed, else not", async (path) => {
    const { did, cookie } = await signedIn();
    expect(await (await get(path, cookie)).text()).not.toContain("Privacy notice updated");
    // An acceptance of an older notice: the gate passes and sets privacyNotice (domains/identity auth/gates.ts).
    await accounts.acceptTerms(did, TERMS_VERSION, "2000-01-01", AbortSignal.timeout(5000));
    const html = await (await get(path, cookie)).text();
    expect(PRIVACY_VERSION).not.toBe("2000-01-01");
    expect(html).toContain("Privacy notice updated");
    expect(html).toContain('href="/legal/privacy"');
  });
});

describe("the settings theme picker", () => {
  test("the menu offers the theme form, preset to the member's theme and returning to the page", async () => {
    const { cookie } = await signedIn();
    const html = await (await get("/settings/account", `${cookie}; __Host-theme=dark`)).text();
    const form = elements(parse(html), "form", { method: "post", action: "/prefs/theme" })[0];
    // The drawer's picker (P2.13e): one submit button per choice, the member's pressed.
    const attr = (
      node: { readonly attrs?: readonly { name: string; value: string }[] | undefined } | undefined,
      name: string,
    ) => node?.attrs?.find((a) => a.name === name)?.value;
    const buttons = elements(form, "button", { name: "theme" });
    expect(buttons.map((button) => [attr(button, "value"), attr(button, "aria-pressed")])).toEqual([
      ["dark", "true"],
      ["system", "false"],
      ["light", "false"],
    ]);
    const back = elements(form, "input", { name: "return" })[0];
    expect(back?.attrs?.find((a) => a.name === "value")?.value).toBe("/settings/account");
  });
});

describe("GET /settings/account", () => {
  test("settings_account_shows_the_account_and_sign_out", async () => {
    const { did, cookie } = await signedIn();
    const response = await get("/settings/account", cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    const html = await response.text();
    expect(sideList(html)).toEqual([
      { href: "/settings/profile", current: false },
      { href: "/settings/privacy", current: false },
      { href: "/settings/account", current: true },
    ]);
    const document = parse(html);
    // No DID document for this member in the stand-ins, so no handle is shown; the DID still is.
    expect(elements(document, "dd").map(textContent)).toEqual(["handle.invalid", did]);
    expect(html).not.toContain("We could not check your handle just now");
    expect(html).toContain('href="https://pds.unset.test/account"');
    expect(html).toContain("Signs this browser out of unset.sh.");
    // One in the page, one in the menu drawer (P2.13e).
    const main = elements(document, "main")[0];
    expect(elements(main, "form", { method: "post", action: "/logout" })).toHaveLength(1);
    expect(html).not.toContain("getBlob");
  });

  test("settings_account_handle_unavailable", async () => {
    const { cookie } = await signedIn(UNREACHABLE);
    const html = await (await get("/settings/account", cookie)).text();
    expect(elements(parse(html), "dd").map(textContent)).toEqual(["handle.invalid", UNREACHABLE]);
    expect(html).toContain("We could not check your handle just now");
  });

  test("a_stored_origin_the_gate_refuses_hides_the_link_and_is_never_replaced", async () => {
    // The column's CHECK admits an address literal; the gate's re-check (sessionIssuerOrigin) does not, and the page
    // then shows no link rather than reading the token set, whose issuer is our PDS.
    for (const stored of ["https://127.0.0.1", "https://localhost"]) {
      const { cookie } = await signedIn(nextDid(), stored);
      const html = await (await get("/settings/account", cookie)).text();
      expect(html).not.toContain("pds.unset.test/account");
      expect(html).not.toContain(stored);
      expect(html).toContain("/logout");
    }
  });

  test("settings_account_offers_sign_out_everywhere", async () => {
    const { cookie } = await signedIn();
    const html = await (await get("/settings/account", cookie)).text();
    const forms = elements(parse(html), "form", { method: "post", action: "/logout/everywhere" });
    expect(forms).toHaveLength(1);
    expect(elements(forms[0], "input")).toEqual([]);
    expect(html).toContain("Signs out every browser, this one too. You will sign in again.");
    expect(elements(forms[0], "button").map((button) => textContent(button).trim())).toEqual(["Sign out everywhere"]);
  });

  test.each(["/settings/profile", "/settings/privacy", "/settings/account"])("guards %s", async (path) => {
    // The gate's final outcome (asked of the integration lane): /login keeps the page to come back to.
    const response = await get(path);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/login?${new URLSearchParams({ next: path })}`);
  });

  test("head_on_a_gated_page_answers_as_its_get", async () => {
    const { cookie } = await signedIn();
    const head = (withCookie: boolean) =>
      web.fetch("/settings/account", {
        method: "HEAD",
        headers: { "x-forwarded-for": clientAddress(), ...(withCookie ? { cookie } : {}) },
      });
    expect((await head(true)).status).toBe(200);
    const refused = await head(false);
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe("/login?next=%2Fsettings%2Faccount");
  });
});

describe("POST /profile", () => {
  test("a cross-site post is refused before anything is read", async () => {
    const { cookie } = await signedIn();
    expect((await postProfile("displayName=A", { cookie, crossSite: true })).status).toBe(403);
  });

  test("signed out goes to sign-in and saves nothing", async () => {
    const response = await postProfile("displayName=A");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fme");
  });

  test("signed out from the enhanced form gets the same redirect as JSON", async () => {
    const response = await postProfile("displayName=A", { accept: "application/json" });
    expect(await response.json()).toEqual({ type: "redirect", status: 303, location: "/login?next=%2Fme" });
  });

  test.each([
    ["a repeated field", "displayName=A&headline=one&headline=again"],
    ["an unsafe website", "displayName=A&website=javascript%3Aalert(1)"],
    ["a name that is too long", `displayName=${"x".repeat(65)}`],
    ["a newline in the name", "displayName=A%0AB"],
  ])("%s is refused with 400", async (_name, body) => {
    const { cookie } = await signedIn();
    expect((await postProfile(body, { cookie })).status).toBe(400);
  });

  test("a body over the limit is refused", async () => {
    const { cookie } = await signedIn();
    expect((await postProfile(`displayName=${"x".repeat(96 * 1024)}`, { cookie })).status).toBe(413);
  });

  test("profile_save_is_limited_per_member", async () => {
    // 30 a minute for one member whatever their address; the refused saves above count too, so each is a new address.
    const { cookie } = await signedIn();
    for (let n = 0; n < 30; n += 1) {
      expect((await postProfile("displayName=A%0AB", { cookie })).status, `save ${n + 1}`).toBe(400);
    }
    expect((await postProfile("displayName=A%0AB", { cookie })).status).toBe(429);
    const other = await signedIn();
    expect((await postProfile("displayName=A%0AB", { cookie: other.cookie })).status).toBe(400);
  });

  test("a GET has no page", async () => {
    const { cookie } = await signedIn();
    expect((await get("/profile", cookie)).status).toBe(404);
  });
});
