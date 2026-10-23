// P2.13c (routes/settings.ts): the settings pages inside the side list. The gate, the session store and the handle
// check are P2.12's, P2.03's and P2.02's, tested in their own suites; here they return each case the pages handle.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as web from "@unset/apps-web";
import type { Did, HandleVerdict } from "@unset/domains-identity";
import type { PublishedProfile } from "@unset/domains-profile";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { parse } from "parse5";
import { afterAll, describe, expect, test } from "vitest";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { elements, textContent } from "../web/fixtures/html.ts";
import { pageResponse } from "../web/page.ts";
import { type SettingsDeps, settingsRoutes } from "./settings.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const SESSION: Session = { did: DID, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

type World = {
  signedIn?: boolean;
  verdict?: HandleVerdict;
  /** The issuer OAuth recorded for the DID; a throw stands for an unreadable token set. */
  issuer?: string | null | Error;
  /** What the member's PDS holds for the profile; absent means no profile yet. */
  profile?: PublishedProfile | null | "unavailable";
};

function setup(world: World = {}) {
  const opened: string[] = [];
  const checked: string[] = [];
  const log = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
  const deps: SettingsDeps = {
    open: async (_request, _deadline, next) => {
      opened.push(next);
      if (world.signedIn === false) {
        return new Response(null, {
          status: 303,
          headers: { location: `/login?${new URLSearchParams({ next })}`, "cache-control": "no-store" },
        });
      }
      return { session: SESSION, privacyNotice: false };
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
    loadProfile: async () => world.profile ?? null,
    issuerOf: async () => {
      const issuer = world.issuer === undefined ? "https://pds.unset.test" : world.issuer;
      if (issuer instanceof Error) throw issuer;
      return issuer;
    },
    pdsIssuer: "https://pds.unset.test",
    log,
  };
  const server = createServer({ config: CONFIG, routes: settingsRoutes(deps), policies, log });
  const get = (path: string) =>
    server.request(
      new Request(`${ORIGIN}${path}`, {
        headers: { host: "unset.test", "x-forwarded-for": "192.0.2.1", cookie: "__Host-sid=x" },
      }),
      "10.0.0.1",
    );
  return { get, opened, checked };
}

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
    const { get, opened } = setup();
    const response = await get("/settings?error=logout.confirm_required");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings/profile?error=logout.confirm_required");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(opened).toEqual([]);
  });

  test("settings.redirect without a query", async () => {
    const response = await setup().get("/settings");
    expect(response.headers.get("location")).toBe("/settings/profile");
  });
});

describe("GET /settings/profile", () => {
  test("settings_profile_in_the_side_list", async () => {
    const response = await setup().get("/settings/profile");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(sideList(html)).toEqual([
      { href: "/settings/profile", current: true },
      { href: "/settings/account", current: false },
    ]);
    // The side column of the profile page is edited here (Alex 04:29Z): a plain form to POST /profile, back here.
    const form = elements(parse(html), "form").find((f) =>
      f.attrs?.some((a) => a.name === "action" && a.value === "/profile"),
    );
    expect(form).toBeDefined();
    // P2.13e: the only script is the island boot and the drawer's theme-picker props.
    expect(
      elements(parse(html), "script").map((script) => script.attrs?.find((a) => a.name === "type")?.value),
    ).toEqual(["application/json", "module"]);
  });
});

describe("Settings › Profile form", () => {
  const ALICE: PublishedProfile = {
    displayName: "Alice Moreau",
    headline: "Designer.",
    location: "Toronto, Ontario",
    website: "https://alice.example",
    readme: [
      {
        $type: "sh.unset.profile#heading",
        level: 2,
        content: [{ $type: "sh.unset.profile#textRun", text: "About me" }],
      },
    ],
    links: "https://github.com/alicem\nhttps://bsky.app/profile/alice",
  };
  /** The name and value of each field in the form that posts to /profile. */
  const fieldsOf = (html: string) => {
    const form = elements(parse(html), "form").find((f) =>
      f.attrs?.some((a) => a.name === "action" && a.value === "/profile"),
    );
    if (form === undefined) throw new Error("no profile form");
    return Object.fromEntries(
      [...elements(form, "input"), ...elements(form, "textarea")].map((el) => {
        const attr = (name: string) => el.attrs?.find((a) => a.name === name)?.value;
        return [attr("name"), el.nodeName === "textarea" ? textContent(el) : attr("value")];
      }),
    );
  };

  test("settings_profile_form_is_prefilled_and_leaves_the_readme_out", async () => {
    const html = await (await setup({ profile: ALICE }).get("/settings/profile")).text();
    expect(fieldsOf(html)).toEqual({
      next: "/settings/profile",
      displayName: "Alice Moreau",
      headline: "Designer.",
      location: "Toronto, Ontario",
      website: "https://alice.example",
      links: ALICE.links,
    });
  });

  test("settings_profile_unreadable_offers_no_form", async () => {
    const html = await (await setup({ profile: "unavailable" }).get("/settings/profile")).text();
    expect(html).toContain("We could not load your profile just now");
    expect(elements(parse(html), "form").some((f) => f.attrs?.some((a) => a.value === "/profile"))).toBe(false);
  });
});

describe("GET /settings/account", () => {
  test("settings_account_shows_the_account_and_sign_out", async () => {
    const { get, checked } = setup();
    const response = await get("/settings/account");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    const html = await response.text();
    expect(sideList(html)).toEqual([
      { href: "/settings/profile", current: false },
      { href: "/settings/account", current: true },
    ]);
    const document = parse(html);
    const values = elements(document, "dd").map(textContent);
    expect(values).toEqual(["alice.pds.unset.test", DID]);
    expect(html).toContain('href="https://pds.unset.test/account"');
    expect(html).toContain("Signs this browser out of unset.sh.");
    // One in the page, one in the menu drawer (P2.13e).
    const main = elements(document, "main")[0];
    expect(elements(main, "form", { method: "post", action: "/logout" })).toHaveLength(1);
    expect(html).not.toContain("getBlob");
    expect(checked).toEqual([DID]);
  });

  test("settings_account_without_a_recorded_issuer_has_no_account_link", async () => {
    const html = await (await setup({ issuer: null }).get("/settings/account")).text();
    expect(html).not.toContain("pds.unset.test/account");
    expect(html).toContain("/logout");
  });

  // Moved from the profile page's tests when the account details moved here (P2.13c; Alex 2026-10-23).
  test("settings_account_links_a_foreign_recorded_issuer", async () => {
    // P2.08b: the account link is where a user goes to revoke, so it follows the issuer recorded at sign-in.
    const html = await (await setup({ issuer: "https://pds.example" }).get("/settings/account")).text();
    expect(html).toContain('href="https://pds.example/"');
    expect(html).toContain("your sign-in server (pds.example)");
    expect(html).not.toContain('href="https://pds.unset.test');
  });

  async function hidesIssuer(issuer: string, absent: string): Promise<void> {
    const html = await (await setup({ issuer }).get("/settings/account")).text();
    expect(html, issuer).not.toContain(absent);
    expect(html, issuer).not.toContain("your sign-in server");
    expect(html, issuer).not.toContain("Your account on");
    expect(html, issuer).not.toContain('href="https://pds.unset.test');
  }

  test("settings_account_hides_an_ipv4_issuer", () => hidesIssuer("https://198.51.100.1", "198.51.100.1"));
  test("settings_account_hides_an_ipv6_issuer", () => hidesIssuer("https://[2001:db8::1]", "2001:db8"));
  test("settings_account_hides_a_localhost_issuer", () => hidesIssuer("https://localhost", "localhost"));
  test("settings_account_hides_a_localhost_child_issuer", () => hidesIssuer("https://app.localhost", "app.localhost"));
  test("settings_account_hides_a_trailing_dot_issuer", () => hidesIssuer("https://pds.example.", "pds.example"));

  test("settings_account_hides_a_non_default_port_issuer", async () => {
    // Only a bare https origin counts (architecture 04:15Z item 2): a port drops the link (P2.08g, verify-1054
    // mutant 13).
    const html = await (await setup({ issuer: "https://pds.example:8443" }).get("/settings/account")).text();
    expect(html).not.toContain("pds.example");
    expect(html).not.toContain('href="https://pds.unset.test');
  });

  test("settings_account_lookalike_issuer_is_not_ours", async () => {
    // "Ours" is string equality with our issuer (architecture 04:15Z item 4). A lookalike gets the plain foreign
    // link, never the sentence that says it is where the password is typed (P2.08g, verify-1054 mutant 11).
    for (const lookalike of ["https://evilpds.unset.test", "https://pds.unset.test.example"]) {
      const html = await (await setup({ issuer: lookalike }).get("/settings/account")).text();
      expect(html, lookalike).not.toContain("You are going to");
      expect(html, lookalike).not.toContain(`href="${lookalike}/account"`);
      expect(html, lookalike).toContain(`href="${lookalike}/"`);
    }
  });

  test("settings_account_with_an_unreadable_issuer_still_renders", async () => {
    const response = await setup({ issuer: new Error("unseal failed") }).get("/settings/account");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(DID);
    expect(html).not.toContain('href="https://pds.unset.test');
  });

  test("settings_account_handle_unavailable", async () => {
    const html = await (await setup({ verdict: { status: "unavailable" } }).get("/settings/account")).text();
    expect(html).toContain("handle.invalid");
    expect(html).toContain("We could not check your handle just now");
  });

  test.each(["/settings/profile", "/settings/account"])("guards %s", async (path) => {
    const { get, opened, checked } = setup({ signedIn: false });
    const response = await get(path);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/login?${new URLSearchParams({ next: path })}`);
    expect(opened).toEqual([path]);
    expect(checked).toEqual([]);
  });
});
