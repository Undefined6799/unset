// POST /profile (routes/profile.ts): the owner saves their profile. The app gate and the PDS write are stand-ins
// returning each case the route handles; the write itself is tested in infrastructure/pds/profile-record.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Did } from "@unset/domains-identity";
import type { ProfileEdit } from "@unset/domains-profile";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { type ProfileSave, profileRoutes } from "./profile.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const SESSION: Session = { did: DID, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

function setup(world: { signedIn?: boolean; save?: ProfileSave } = {}) {
  const saved: { did: Did; fields: ProfileEdit }[] = [];
  const log = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
  const routes = profileRoutes({
    open: async (_request, _deadline, next) =>
      world.signedIn === false
        ? new Response(null, { status: 303, headers: { location: `/login?${new URLSearchParams({ next })}` } })
        : { session: SESSION, privacyNotice: false },
    saveProfile: async (did, fields) => {
      saved.push({ did, fields });
      return world.save ?? { kind: "saved" };
    },
  });
  const server = createServer({ config: CONFIG, routes, policies, log });
  const post = (body: string, init: { csrf?: boolean } = {}) => {
    const headers = new Headers({
      host: "unset.test",
      "x-forwarded-for": "192.0.2.1",
      cookie: "__Host-sid=x",
      "content-type": "application/x-www-form-urlencoded",
    });
    if (init.csrf !== false) {
      headers.set("origin", ORIGIN);
      headers.set("sec-fetch-site", "same-origin");
    }
    return server.request(new Request(`${ORIGIN}/profile`, { method: "POST", headers, body }), "10.0.0.1");
  };
  return { post, saved };
}

const FORM = new URLSearchParams({
  displayName: " Alice ",
  headline: "Designer.",
  location: "",
  website: "https://alice.example",
  readme: "## About me\r\nhi",
  links: "https://github.com/alicem\r\nhttps://bsky.app/profile/alice",
}).toString();

describe("POST /profile", () => {
  test("saves the session's own profile and returns to it", async () => {
    const { post, saved } = setup();
    const response = await post(FORM);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/${DID}`);
    expect(saved).toEqual([
      {
        did: DID,
        fields: {
          displayName: "Alice",
          headline: "Designer.",
          location: "",
          website: "https://alice.example",
          readme: "## About me\nhi",
          links: "https://github.com/alicem\nhttps://bsky.app/profile/alice",
        },
      },
    ]);
  });

  test("Settings › Profile sends only the side column and comes back to Settings", async () => {
    const { post, saved } = setup();
    const form = new URLSearchParams({ displayName: "Alice", headline: "", next: "/settings/profile" });
    const response = await post(form.toString());
    expect(response.headers.get("location")).toBe("/settings/profile");
    expect(saved).toEqual([{ did: DID, fields: { displayName: "Alice", headline: "" } }]);
  });

  test("a DID in the form never picks whose profile is written (SE-2)", async () => {
    const { post, saved } = setup();
    const other = `did:plc:${"b".repeat(24)}`;
    const response = await post(new URLSearchParams({ displayName: "Mallory", did: other, repo: other }).toString());
    expect(response.headers.get("location")).toBe(`/${DID}`);
    expect(saved).toEqual([{ did: DID, fields: { displayName: "Mallory" } }]);
  });

  test("any other next returns to the member's own page", async () => {
    const { post } = setup();
    const response = await post(
      new URLSearchParams({ displayName: "Alice", next: "https://evil.example/" }).toString(),
    );
    expect(response.headers.get("location")).toBe(`/${DID}`);
  });

  test("a cross-site post is refused before anything is read", async () => {
    const { post, saved } = setup();
    expect((await post(FORM, { csrf: false })).status).toBe(403);
    expect(saved).toEqual([]);
  });

  test("signed out goes to sign-in and saves nothing", async () => {
    const { post, saved } = setup({ signedIn: false });
    const response = await post(FORM);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fdid");
    expect(saved).toEqual([]);
  });

  test.each([
    ["a repeated field", `${FORM}&headline=again`, 400],
    ["an unsafe website", "displayName=A&website=javascript%3Aalert(1)", 400],
    ["a name that is too long", `displayName=${"x".repeat(65)}`, 400],
    ["a newline in the name", "displayName=A%0AB", 400],
  ])("%s is refused and nothing is written", async (_name, body, status) => {
    const { post, saved } = setup();
    expect((await post(body)).status).toBe(status);
    expect(saved).toEqual([]);
  });

  test.each([
    [{ kind: "conflict" } as const, 409],
    [{ kind: "refused", code: "profile.name_required" } as const, 400],
    [{ kind: "unavailable" } as const, 503],
  ])("a %o save answers %i", async (save, status) => {
    const { post } = setup({ save });
    expect((await post(FORM)).status).toBe(status);
  });

  test("a dead grant goes to the sign-in pages", async () => {
    const { post } = setup({ save: { kind: "redirect", location: "/login?error=login.session_ended" } });
    const response = await post(FORM);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=login.session_ended");
  });
});
