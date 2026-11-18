// What Settings › Account shows (account.server.ts), as interfaces/http/routes/settings.test.ts and the account-issuer
// cases check it. The handle check and the token-set read reach the network and the store, so they are doubles (TE-1).
import type { Did, HandleVerdict } from "@unset/domains-identity";
import { createLogger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import { type AccountDeps, accountView, issuerOrigin } from "./account.server.ts";

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
  const built: AccountDeps = {
    verifyHandle: async () =>
      world.verdict ?? { status: "verified", handle: "alice.pds.unset.test" as never, checkedAt: 0 },
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

describe("accountView", () => {
  test("settings_account_shows_the_account_and_our_link", async () => {
    const view = await accountView(deps().deps, DID, undefined, SIGNAL);
    expect(view).toEqual({
      handle: "alice.pds.unset.test",
      did: DID,
      handleUnavailable: false,
      link: { href: "https://pds.unset.test/account", host: "pds.unset.test", ours: true },
    });
  });

  test("a foreign sign-in server is linked at its root", async () => {
    const view = await accountView(deps({ issuer: "https://bsky.social" }).deps, DID, undefined, SIGNAL);
    expect(view.link).toEqual({ href: "https://bsky.social/", host: "bsky.social", ours: false });
  });

  test("settings_account_without_a_recorded_issuer_has_no_account_link", async () => {
    expect((await accountView(deps({ issuer: null }).deps, DID, undefined, SIGNAL)).link).toBeNull();
  });

  test("an unreadable token set drops the link, never the page, and logs only its kind", async () => {
    const world = deps({ issuer: new TypeError(`secret ${DID}`) });
    expect((await accountView(world.deps, DID, undefined, SIGNAL)).link).toBeNull();
    expect(world.lines.map((line) => [line.event, line.kind])).toEqual([["auth.account_issuer_unknown", "TypeError"]]);
    expect(JSON.stringify(world.lines)).not.toContain(DID);
  });

  test("settings_account_handle_unavailable", async () => {
    const view = await accountView(deps({ verdict: { status: "unavailable" } }).deps, DID, undefined, SIGNAL);
    expect(view.handle).toBe("handle.invalid");
    expect(view.handleUnavailable).toBe(true);
  });

  test("an invalid handle shows handle.invalid without the unavailable note", async () => {
    const view = await accountView(deps({ verdict: { status: "invalid", checkedAt: 0 } }).deps, DID, undefined, SIGNAL);
    expect([view.handle, view.handleUnavailable]).toEqual(["handle.invalid", false]);
  });

  test("the session's own origin is used and the token set is not read", async () => {
    const world = deps({ issuer: "https://other.example" });
    const view = await accountView(world.deps, DID, OURS, SIGNAL);
    expect(view.link?.href).toBe("https://pds.unset.test/account");
    expect(world.reads).toEqual([]);
  });

  test("a stored origin that is no longer a bare https origin hides the link and is never replaced", async () => {
    const world = deps();
    for (const stored of [
      "http://pds.unset.test",
      "https://127.0.0.1",
      "https://pds.unset.test/x",
      "https://a.test:8443",
    ]) {
      expect((await accountView(world.deps, DID, stored, SIGNAL)).link).toBeNull();
    }
    expect(world.reads).toEqual([]);
  });

  test("a token-set issuer that is not https on a DNS name gives no link", async () => {
    for (const issuer of [
      "http://pds.unset.test",
      "https://localhost",
      "https://[::1]",
      "https://pds.test.",
      "javascript:x",
    ]) {
      expect((await accountView(deps({ issuer }).deps, DID, undefined, SIGNAL)).link).toBeNull();
    }
  });
});

test("issuerOrigin keeps only a bare https origin on a DNS name", () => {
  expect(issuerOrigin("https://pds.unset.test")).toBe("https://pds.unset.test");
  expect(issuerOrigin("https://u:p@pds.unset.test")).toBeNull();
  expect(issuerOrigin("https://app.localhost")).toBeNull();
  expect(issuerOrigin("not a url")).toBeNull();
});
