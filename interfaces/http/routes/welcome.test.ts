// P2.12 (routes/welcome.ts): age, terms, the chat placeholder and the block. The store and the grant are fakes; the
// real SQL is tests/integration/http/onboarding.test.ts. The date is posted and then must not appear in a row or a log.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as web from "@unset/apps-web";
import type { EmailCache } from "@unset/domains-identity";
import { type Did, type Onboarding, PRIVACY_VERSION, TERMS_VERSION } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { ERROR_MESSAGES } from "@unset/shared-errors";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { parse } from "parse5";
import { afterAll, describe, expect, test } from "vitest";
import type { AccountStore } from "../account.ts";
import { type AppGate, openApp } from "../app-gate.ts";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { elements } from "../web/fixtures/html.ts";
import { pageResponse } from "../web/page.ts";
import { meRoutes } from "./me.ts";
import { settingsRoutes } from "./settings.ts";
import { welcomeRoutes } from "./welcome.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const NOW = new Date(Date.UTC(2026, 9, 17, 12, 0, 0));
const PDS = "https://pds.unset.test";
const REPO = join(import.meta.dirname, "..", "..", "..");
const SECRETS = mkdtempSync(join(tmpdir(), "welcome-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

type Row = {
  onboarding: Onboarding;
  termsVersion: string | null;
  privacyVersion: string | null;
  ageConfirmedAt: string | null;
};

type World = {
  session?: Session | null;
  clearCookie?: boolean;
  row?: Row | null;
  countryRule?: boolean;
  supportEmail?: string;
  issuer?: string | null;
  issuerThrows?: boolean;
  blockThrows?: boolean;
  revokeThrows?: boolean;
  endThrows?: boolean;
  email?: EmailCache;
};

const sessionOf = (emailConfirmed: boolean | null): Session => ({
  did: DID,
  idHash: Buffer.alloc(32, 7),
  createdAt: new Date(0),
  emailConfirmed,
});

function setup(world: World = {}) {
  let row: Row | null = world.row === undefined ? null : world.row;
  const calls: { op: string; hosted?: boolean }[] = [];
  const order: string[] = [];
  const xrpc: string[] = [];
  let token = true;
  const lines: string[] = [];
  const log = createLogger({
    service: "http",
    commit: "c".repeat(40),
    env: "test",
    write: (line) => lines.push(line),
  });
  const accounts: AccountStore = {
    get: async () =>
      row === null
        ? null
        : { onboarding: row.onboarding, termsVersion: row.termsVersion, privacyVersion: row.privacyVersion },
    confirmAdult: async () => {
      calls.push({ op: "confirmAdult" });
      if (row !== null && row.onboarding !== "age") return false;
      row = { onboarding: "terms", termsVersion: null, privacyVersion: null, ageConfirmedAt: "confirmed" };
      return true;
    },
    acceptTerms: async (_did, terms, privacy) => {
      calls.push({ op: "acceptTerms" });
      if (row === null || (row.onboarding !== "terms" && row.onboarding !== "done")) return null;
      const onboarding = row.onboarding === "done" ? "done" : "chat";
      row = { ...row, onboarding, termsVersion: terms, privacyVersion: privacy };
      return onboarding;
    },
    finishChat: async () => {
      calls.push({ op: "finishChat" });
      if (row === null || row.onboarding !== "chat") return false;
      row = { ...row, onboarding: "done" };
      return true;
    },
    blockUnderage: async (_did, hosted) => {
      if (world.blockThrows) throw Object.assign(new Error("db"), { code: "57014" });
      if (row !== null && row.onboarding !== "age") return null;
      calls.push({ op: "block", hosted });
      order.push("block");
      row = {
        onboarding: "blocked_underage",
        termsVersion: row?.termsVersion ?? null,
        privacyVersion: row?.privacyVersion ?? null,
        ageConfirmedAt: null,
      };
      return { lane: "sec", seq: 7 };
    },
  };
  const readSession = async () => ({
    session: world.session === undefined ? sessionOf(null) : world.session,
    clearCookie: world.clearCookie ?? false,
  });
  const gate: AppGate = {
    readSession,
    loadAccount: (did, deadline) => accounts.get(did, deadline),
    versions: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION },
    emailCache: async () => world.email ?? { confirmed: true, checkedAt: NOW },
    refreshEmail: async () => "confirmed",
    now: () => NOW.getTime(),
    emailRecheckS: 900,
  };
  const page = (input: Parameters<typeof pageResponse>[1]) =>
    pageResponse(
      {
        build: { manifest: { boot: "assets/boot.js", styles: [], fonts: [], islands: new Map() }, files: new Map() },
        render: web.renderPage,
        assetsOrigin: ORIGIN,
        env: "test",
        log,
      },
      input,
    );
  const server = createServer({
    config: CONFIG,
    routes: [
      ...welcomeRoutes({
        readSession,
        accounts,
        versions: gate.versions,
        minAge: 16,
        countryRule: world.countryRule ?? true,
        supportEmail: world.supportEmail ?? "[to fill: SUPPORT_EMAIL]",
        pdsIssuer: PDS,
        issuerOf: async () => {
          if (world.issuerThrows) throw new Error("db");
          return world.issuer === undefined ? PDS : world.issuer;
        },
        revoke: async () => {
          order.push(token ? "revoke" : "revoke-after-delete");
          try {
            if (world.revokeThrows) throw new Error("RevokeFailed");
          } finally {
            // @atproto/oauth-client 0.8.9 deletes the stored set in a finally, including when revoke throws.
            token = false;
          }
        },
        endSessions: async () => {
          order.push(token ? "end-while-token" : "end");
          if (world.endThrows) throw Object.assign(new Error("db"), { code: "57014" });
          token = false;
        },
        now: () => NOW,
        safeHref: web.safeHref,
        page,
        screens: web.screens,
        log,
      }),
      ...settingsRoutes({ gate, page, screens: web.screens }),
      ...meRoutes({
        open: (request, deadline, next) => openApp(gate, request, deadline, next),
        verifyHandle: async () => ({ status: "verified", handle: "alice.pds.unset.test" as never, checkedAt: 0 }),
        page,
        screens: web.screens,
        issuerOf: async () => "https://pds.unset.test",
        pdsIssuer: "https://pds.unset.test",
        log,
      }),
    ],
    policies,
    log,
  });
  const send = (path: string, init: { method?: string; body?: string; theme?: string; csrf?: boolean } = {}) => {
    const headers = new Headers({ host: "unset.test", "x-forwarded-for": "192.0.2.1" });
    headers.set("cookie", init.theme === undefined ? "__Host-sid=x" : `__Host-sid=x; __Host-theme=${init.theme}`);
    const method = init.method ?? "GET";
    if (method === "POST") {
      headers.set("content-type", "application/x-www-form-urlencoded");
      if (init.csrf !== false) {
        headers.set("origin", ORIGIN);
        headers.set("sec-fetch-site", "same-origin");
      }
    }
    const request =
      method === "POST"
        ? new Request(`${ORIGIN}${path}`, { method, headers, body: init.body ?? "" })
        : new Request(`${ORIGIN}${path}`, { method, headers });
    return server.request(request, "10.0.0.1");
  };
  return {
    send,
    calls,
    order,
    xrpc,
    lines,
    row: () => row,
    token: () => token,
  };
}

const post = (body: string) => ({ method: "POST" as const, body });
const visible = (html: string) => html.replace(/<[^>]*>/g, " ");

describe("POST /welcome/age", () => {
  test("age.valid_adult", async () => {
    const { send, calls, lines, row } = setup();
    const response = await send("/welcome/age", post("day=1&month=1&year=2000"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/welcome/terms");
    expect(row()).toMatchObject({ onboarding: "terms", ageConfirmedAt: "confirmed" });
    const dumped = JSON.stringify({ calls, row: row(), lines });
    expect(dumped).not.toContain("2000-01-01");
    expect(dumped).not.toContain("year=2000");
    const account = readFileSync(join(REPO, "interfaces/http/account.ts"), "utf8");
    const migration = readFileSync(join(REPO, "infrastructure/postgres/migrations/0015_app_account.sql"), "utf8");
    expect(account).toContain("confirmAdult(did, deadline)");
    expect(account).not.toMatch(/\b(birth_date|date_of_birth|born_on|dob)\b/);
    expect(migration).not.toMatch(/\b(birth_date|date_of_birth|born_on|dob)\b/);
  });

  test("age.exact_birthday", async () => {
    const allowed = await setup().send("/welcome/age", post("day=17&month=10&year=2010"));
    expect(allowed.headers.get("location")).toBe("/welcome/terms");
    const early = setup();
    const refused = await early.send("/welcome/age", post("day=18&month=10&year=2010"));
    expect(refused.headers.get("location")).toBe("/welcome/blocked");
    expect(early.calls.map((call) => call.op)).toEqual(["block"]);
  });

  test("age.invalid_dates", async () => {
    const bodies = [
      "day=ab&month=1&year=2000",
      "day=31&month=2&year=2000",
      "day=30&month=2&year=2000",
      "day=1&month=1&year=2099",
      "day=1&month=1&year=1850",
    ];
    for (const body of bodies) {
      const { send, calls, row } = setup();
      const response = await send("/welcome/age", post(body));
      expect(response.headers.get("location")).toBe("/welcome/age?error=welcome.date_invalid");
      expect(row()).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  test("age.underage_blocks", async () => {
    const hosted = setup({ issuer: PDS });
    const response = await hosted.send("/welcome/age", post("day=17&month=10&year=2014"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/welcome/blocked");
    expect(response.headers.getSetCookie()).toContain("__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
    expect(hosted.row()?.onboarding).toBe("blocked_underage");
    expect(hosted.calls).toEqual([{ op: "block", hosted: true }]);
    expect(hosted.order).toEqual(["block", "revoke", "end"]);
    expect(hosted.token()).toBe(false);
    expect(hosted.xrpc).toEqual([]);
    const alert = hosted.lines.map((line) => JSON.parse(line) as { event?: string; kind?: string; count?: number });
    expect(alert.find((line) => line.event === "age_gate.hosted_block")).toMatchObject({ kind: "sec", count: 7 });
    expect(hosted.lines.join("\n")).not.toContain(DID);
    const again = await hosted.send("/welcome/age", post("day=1&month=1&year=2014"));
    expect(again.headers.get("location")).toBe("/welcome/blocked");
    expect(hosted.calls).toHaveLength(1);

    const foreign = setup({ issuer: "https://other.example" });
    await foreign.send("/welcome/age", post("day=17&month=10&year=2014"));
    expect(foreign.calls).toEqual([{ op: "block", hosted: false }]);
    expect(foreign.lines.join("\n")).not.toContain("age_gate.hosted_block");

    const failed = setup({ blockThrows: true });
    expect((await failed.send("/welcome/age", post("day=1&month=1&year=2014"))).status).toBe(503);
    expect(failed.order).toEqual([]);

    const unread = setup({ issuerThrows: true });
    const stillBlocked = await unread.send("/welcome/age", post("day=1&month=1&year=2014"));
    expect(stillBlocked.status).toBe(303);
    expect(stillBlocked.headers.get("location")).toBe("/welcome/blocked");
    expect(unread.calls).toEqual([{ op: "block", hosted: false }]);
    expect(unread.order).toEqual(["block", "revoke", "end"]);
    expect(unread.lines.join("\n")).toContain("age_gate.issuer_unknown");
    expect(unread.lines.join("\n")).not.toContain("age_gate.hosted_block");
    expect(unread.lines.join("\n")).not.toContain(DID);

    const revoked = setup({ revokeThrows: true, issuer: "https://other.example" });
    const after = await revoked.send("/welcome/age", post("day=1&month=1&year=2014"));
    expect(after.headers.get("location")).toBe("/welcome/blocked");
    expect(revoked.order).toEqual(["block", "revoke", "end"]);
    expect(revoked.lines.join("\n")).toContain("oauth.revoke_failed");

    const sources = ["interfaces/http/routes/welcome.ts", "interfaces/http/account.ts"]
      .map((path) => readFileSync(join(REPO, path), "utf8"))
      .join("\n");
    expect(sources).not.toContain("deactivateAccount");
  });

  test("age.csrf_denied", async () => {
    const response = await setup().send("/welcome/age", {
      method: "POST",
      body: "day=1&month=1&year=2000",
      csrf: false,
    });
    expect(response.status).toBe(403);
  });
});

describe("POST /welcome/terms", () => {
  const terms: Row = { onboarding: "terms", termsVersion: null, privacyVersion: null, ageConfirmedAt: "confirmed" };
  const shown = `terms_version=${TERMS_VERSION}&privacy_version=${PRIVACY_VERSION}`;

  test("terms.required_boxes", async () => {
    const missing = setup({ row: { ...terms } });
    const first = await missing.send("/welcome/terms", post(`country=yes&${shown}&next=%2Fsettings%2Fprofile`));
    expect(first.headers.get("location")).toBe(
      "/welcome/terms?next=%2Fsettings%2Fprofile&error=welcome.terms_required",
    );
    expect(missing.row()?.onboarding).toBe("terms");

    const country = setup({ row: { ...terms } });
    const second = await country.send("/welcome/terms", post(`accept=yes&${shown}`));
    expect(second.headers.get("location")).toBe("/welcome/terms?error=welcome.country_required");

    const off = setup({ row: { ...terms }, countryRule: false });
    const third = await off.send("/welcome/terms", post(`accept=yes&${shown}`));
    expect(third.headers.get("location")).toBe("/welcome/chat");
    expect(off.row()).toMatchObject({
      onboarding: "chat",
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
    });
  });

  test("terms.version_bump", async () => {
    const row: Row = {
      onboarding: "done",
      termsVersion: "2020-01-01",
      privacyVersion: PRIVACY_VERSION,
      ageConfirmedAt: "confirmed",
    };
    const { send, calls } = setup({ row, email: { confirmed: true, checkedAt: NOW } });
    expect((await send("/did")).headers.get("location")).toBe("/welcome/terms?next=%2Fdid");
    expect((await send("/settings/profile")).headers.get("location")).toBe("/welcome/terms?next=%2Fsettings%2Fprofile");
    for (const path of ["/welcome", "/welcome/age"]) {
      const response = await send(path);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/welcome/terms");
    }
    expect(calls).toEqual([]);
    const accepted = await send("/welcome/terms", post(`accept=yes&country=yes&${shown}&next=%2Fsettings%2Fprofile`));
    expect(accepted.headers.get("location")).toBe("/settings/profile");
    const invalid = setup({ row: { ...row } });
    const back = await invalid.send("/welcome/terms", post(`accept=yes&country=yes&${shown}&next=%2Flogin`));
    expect(back.headers.get("location")).toBe("/did");
    const stale = setup({ row: { ...row } });
    const old = await stale.send(
      "/welcome/terms",
      post("accept=yes&country=yes&terms_version=2020-01-01&privacy_version=2020-01-01&next=%2Fsettings%2Fprofile"),
    );
    expect(old.headers.get("location")).toBe("/welcome/terms?next=%2Fsettings%2Fprofile");
    expect(stale.row()?.termsVersion).toBe("2020-01-01");
    expect(stale.calls).toEqual([]);
  });
});

describe("the app gate", () => {
  test("terms.privacy_bump_notice_only", async () => {
    const row: Row = {
      onboarding: "done",
      termsVersion: TERMS_VERSION,
      privacyVersion: "2020-01-01",
      ageConfirmedAt: "confirmed",
    };
    const { send } = setup({ row, email: { confirmed: true, checkedAt: NOW } });
    const first = await send(`/${DID}`);
    expect(first.status).toBe(200);
    const html = await first.text();
    expect(html.match(/The privacy notice has changed\./g)).toHaveLength(1);
    expect(html).toContain('href="/legal/privacy"');
    expect((await send(`/${DID}`)).status).toBe(200);
  });

  test("blocked.signin_again", async () => {
    const row: Row = { onboarding: "blocked_underage", termsVersion: null, privacyVersion: null, ageConfirmedAt: null };
    const { send, order } = setup({ row: { ...row }, email: { confirmed: true, checkedAt: NOW } });
    for (const path of ["/did", "/me", `/${DID}`, "/settings/profile", "/welcome/age"]) {
      const response = await send(path);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/welcome/blocked");
    }
    expect(order).toEqual([]);
  });

  test("onboarded.guard_order", async () => {
    const fresh = setup();
    expect((await fresh.send("/settings/profile")).headers.get("location")).toBe("/welcome");
    const unverified = setup({
      row: {
        onboarding: "done",
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        ageConfirmedAt: "confirmed",
      },
      email: { confirmed: null, checkedAt: null },
    });
    expect((await unverified.send("/settings/profile")).headers.get("location")).toBe("/verify-email");
  });

  test("settings_navigation_renders_only_after_the_existing_gates", async () => {
    const { send } = setup({
      row: {
        onboarding: "done",
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        ageConfirmedAt: "confirmed",
      },
    });
    const response = await send("/settings/profile");
    expect(response.status).toBe(200);
    const document = parse(await response.text());
    expect(
      elements(elements(document, "nav")[0], "a", { href: "/settings/profile", "aria-current": "page" }),
    ).toHaveLength(1);
    expect(elements(elements(document, "nav")[0], "a", { href: `/${DID}` })).toHaveLength(1);
    expect(elements(document, "script")).toHaveLength(0);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    const refused = await setup({ session: null }).send("/settings/profile");
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe("/login?next=%2Fsettings%2Fprofile");
  });
});

describe("the chat placeholder", () => {
  const chat: Row = {
    onboarding: "chat",
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    ageConfirmedAt: "confirmed",
  };

  test("welcome.chat_then_verify", async () => {
    const { send, row } = setup({ row: { ...chat } });
    const response = await send("/welcome/chat", post(""));
    expect(response.headers.get("location")).toBe("/verify-email");
    expect(row()?.onboarding).toBe("done");
  });

  test("welcome.chat_when_email_confirmed", async () => {
    const { send } = setup({ row: { ...chat }, session: sessionOf(true) });
    expect((await send("/welcome/chat", post(""))).headers.get("location")).toBe("/did");
  });
});

test("completed_onboarding_returns_to_the_profile_resolver", async () => {
  const { send } = setup({
    row: {
      onboarding: "done",
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      ageConfirmedAt: "confirmed",
    },
    session: sessionOf(true),
  });
  for (const path of ["/welcome", "/welcome/age", "/welcome/terms", "/welcome/chat"]) {
    const response = await send(path);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/did");
  }
});

describe("welcome screens", () => {
  test("welcome_screens_structure", async () => {
    const catalog = readFileSync(join(REPO, "apps/web/src/screens/welcome/messages.ts"), "utf8");
    expect(catalog).not.toMatch(/\b16\b/);
    for (const code of ["welcome.date_invalid", "welcome.terms_required", "welcome.country_required"] as const) {
      expect(ERROR_MESSAGES[code]).not.toMatch(/\b16\b/);
    }
    const pages = [
      { path: "/welcome/age", row: null, heading: "When were you born?" },
      {
        path: "/welcome/terms",
        row: { onboarding: "terms" as const, termsVersion: null, privacyVersion: null, ageConfirmedAt: "confirmed" },
        heading: "Terms and privacy",
      },
      {
        path: "/welcome/chat",
        row: {
          onboarding: "chat" as const,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
          ageConfirmedAt: "confirmed",
        },
        heading: "Chat comes later",
      },
      {
        path: "/welcome/blocked",
        row: {
          onboarding: "blocked_underage" as const,
          termsVersion: null,
          privacyVersion: null,
          ageConfirmedAt: null,
        },
        heading: "We can't offer you an account right now",
      },
    ];
    for (const page of pages) {
      for (const theme of ["dark", "light"] as const) {
        for (const query of ["", "?lang=fr"]) {
          const { send } = setup({ row: page.row, supportEmail: "help@unset.test" });
          const response = await send(`${page.path}${query}`, { theme });
          expect(response.status, `${page.path} ${theme} ${query}`).toBe(200);
          const html = await response.text();
          expect(html).toContain('lang="en"');
          expect(html).not.toContain('lang="fr"');
          expect(html).toContain(`data-theme="${theme}"`);
          expect(html.replaceAll("&#x27;", "'")).toContain(page.heading);
          expect(html.match(/<h1\b/g)).toHaveLength(1);
          expect(html).not.toContain("<script");
        }
      }
    }
    const age = await (await setup().send("/welcome/age?error=welcome.date_invalid")).text();
    expect(age).toContain("That date is not a real calendar date.");
    expect(visible(age)).not.toMatch(/\b16\b/);
    expect(age).toContain("Day");
    expect(age).toContain("Month");
    expect(age).toContain("Year");
    const blocked = await (
      await setup({
        row: { onboarding: "blocked_underage", termsVersion: null, privacyVersion: null, ageConfirmedAt: null },
        supportEmail: "help@unset.test",
      }).send("/welcome/blocked")
    ).text();
    expect(blocked).toMatch(/mailto:help@unset\.test\?subject=Appeal(?:%20|\+)[0-9a-f-]{36}/);
    // The screen offers nothing to submit; the one form is the footer's theme form (P1.25f).
    const blockedDoc = parse(blocked);
    expect(elements(elements(blockedDoc, "main")[0], "form")).toHaveLength(0);
    expect(elements(blockedDoc, "form").map((form) => form.attrs)).toEqual([
      [
        { name: "action", value: "/prefs/theme" },
        { name: "method", value: "post" },
      ],
    ]);
    expect(blocked).not.toContain(DID);
    const unpublished = await (
      await setup({
        row: { onboarding: "blocked_underage", termsVersion: null, privacyVersion: null, ageConfirmedAt: null },
      }).send("/welcome/blocked")
    ).text();
    expect(unpublished).toContain("The review address is not published on this page yet.");
    expect(unpublished).not.toContain("mailto:");
  });
});
