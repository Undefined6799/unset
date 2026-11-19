// The account view (account.ts), with the cases interfaces/http's settings.test.ts and account-issuer checks cover. The
// handle check and the token-set read reach the network and the store, so they are doubles (TE-1).
import type { Did, HandleVerdict } from "@unset/domains-identity";
import { createLogger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import { type AccountDeps, accountView, shellAccount } from "./account.ts";

const DID = `did:plc:${"a".repeat(24)}` as Did;
const OURS = "https://pds.unset.test";
const SIGNAL = new AbortController().signal;

function deps(world: { verdict?: HandleVerdict; issuer?: string | null | Error } = {}) {
  const reads: Did[] = [];
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "web",
    commit: "c".repeat(40),
    env: "test",
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const verdict: HandleVerdict = world.verdict ?? {
    status: "verified",
    handle: "alice.pds.unset.test" as never,
    checkedAt: 0,
  };
  const built: AccountDeps = {
    handles: { verifyHandle: async () => verdict } as unknown as AccountDeps["handles"],
    issuerOf: async (did) => {
      reads.push(did);
      if (world.issuer instanceof Error) throw world.issuer;
      return world.issuer === undefined ? OURS : world.issuer;
    },
    pdsIssuer: OURS,
    log,
  };
  return { deps: built, reads, lines };
}

const view = (world: Parameters<typeof deps>[0], carried?: string | null) =>
  accountView(deps(world).deps, DID, carried, SIGNAL);

describe("accountView", () => {
  test("a verified member sees their handle, their DID and our account page", async () => {
    expect(await view({})).toEqual({
      handle: "alice.pds.unset.test",
      did: DID,
      handleUnavailable: false,
      verified: true,
      accountLink: { href: "https://pds.unset.test/account", host: "pds.unset.test", ours: true },
    });
  });

  test("a foreign sign-in server is linked at its root, and a lookalike of ours is foreign", async () => {
    expect((await view({ issuer: "https://bsky.social" })).accountLink).toEqual({
      href: "https://bsky.social/",
      host: "bsky.social",
      ours: false,
    });
    expect((await view({ issuer: "https://pds.unset.test.evil.example" })).accountLink).toEqual({
      href: "https://pds.unset.test.evil.example/",
      host: "pds.unset.test.evil.example",
      ours: false,
    });
  });

  test("no recorded issuer gives no link", async () => {
    expect((await view({ issuer: null })).accountLink).toBeNull();
  });

  test("an unreadable token set drops the link, never the page, and logs only its kind", async () => {
    const world = deps({ issuer: new TypeError(`secret ${DID}`) });
    expect((await accountView(world.deps, DID, undefined, SIGNAL)).accountLink).toBeNull();
    expect(world.lines.map((line) => [line.event, line.kind])).toEqual([["auth.account_issuer_unknown", "TypeError"]]);
    expect(JSON.stringify(world.lines)).not.toContain(DID);
  });

  test("an unavailable check shows handle.invalid with the unavailable note", async () => {
    const result = await view({ verdict: { status: "unavailable" } });
    expect([result.handle, result.handleUnavailable, result.verified]).toEqual(["handle.invalid", true, false]);
  });

  test("an invalid handle shows handle.invalid without the unavailable note", async () => {
    const result = await view({ verdict: { status: "invalid", checkedAt: 0 } });
    expect([result.handle, result.handleUnavailable, result.verified]).toEqual(["handle.invalid", false, false]);
  });

  test("the session's own origin is used and the token set is not read", async () => {
    const world = deps({ issuer: "https://other.example" });
    expect((await accountView(world.deps, DID, OURS, SIGNAL)).accountLink?.href).toBe("https://pds.unset.test/account");
    expect(world.reads).toEqual([]);
  });

  test("a stored origin the gate refused (null) hides the link and is never replaced", async () => {
    const world = deps();
    expect((await accountView(world.deps, DID, null, SIGNAL)).accountLink).toBeNull();
    expect(world.reads).toEqual([]);
  });

  test.each([
    ["not https", "http://pds.unset.test"],
    ["an IPv4 address", "https://192.0.2.1"],
    ["an IPv6 address", "https://[::1]"],
    ["localhost", "https://localhost"],
    ["a name under localhost", "https://pds.localhost"],
    ["a trailing dot", "https://pds.unset.test."],
    ["a port", "https://pds.unset.test:8443"],
    ["a user", "https://u:p@pds.unset.test"],
    ["another scheme", "javascript:alert(1)"],
    ["not a URL", "not a url"],
  ])("a token-set issuer with %s gives no link", async (_name, issuer) => {
    expect((await view({ issuer })).accountLink).toBeNull();
  });
});

// Staging walkthrough 2026-11-19: the account button showed the member's letter on their own page and a generic icon
// on settings, home and legal pages; every page's button now names the member the same way, from the cache only.
describe("shellAccount", () => {
  const handles = (handle: string | null) => ({ verifiedHandle: () => handle }) as unknown as AccountDeps["handles"];

  test("a member whose handle a check verified is named by it", () => {
    expect(shellAccount({ handles: handles("alice.pds.unset.test") }, DID)).toEqual({
      path: `/${DID}`,
      name: "alice.pds.unset.test",
    });
  });

  test("with no verified handle cached the button names nothing and keeps its icon", () => {
    expect(shellAccount({ handles: handles(null) }, DID)).toEqual({ path: `/${DID}` });
  });
});
