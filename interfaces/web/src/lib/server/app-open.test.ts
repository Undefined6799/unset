// Whether an error page may offer a member the app's menus (app-open.ts). The account read reaches Postgres, so it is a
// double here (TE-1); the database path itself is covered by tests/integration/web/welcome/onboarding.test.ts.
import type { Did, OnboardingAccount } from "@unset/domains-identity";
import { createLogger } from "@unset/shared-log";
import { expect, test } from "vitest";
import { type AppOpenDeps, appOpen } from "./app-open.ts";

const DID = `did:plc:${"a".repeat(24)}` as Did;
const SIGNAL = new AbortController().signal;
const VERSIONS = { terms: "t1", privacy: "p1" };
const DONE: OnboardingAccount = {
  onboarding: "done",
  termsVersion: "t1",
  privacyVersion: "p1",
  privacyNoticeSeenVersion: null,
};

function deps(account: OnboardingAccount | null | Error) {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "web",
    commit: "c".repeat(40),
    env: "test",
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const built: AppOpenDeps = {
    readAccount: async () => {
      if (account instanceof Error) throw account;
      return account;
    },
    versions: VERSIONS,
    log,
  };
  return { deps: built, lines };
}

test("an_onboarded_member_on_a_missing_path_gets_the_app", async () => {
  expect(await appOpen(deps(DONE).deps, DID, null, SIGNAL)).toBe(true);
});

test("a_member_mid_onboarding_or_with_no_account_does_not", async () => {
  expect(await appOpen(deps({ ...DONE, onboarding: "age" }).deps, DID, null, SIGNAL)).toBe(false);
  expect(await appOpen(deps(null).deps, DID, null, SIGNAL)).toBe(false);
});

test("a_matched_route_decides_without_a_read", async () => {
  const failing = deps(new Error("no read expected")).deps;
  expect(await appOpen(failing, DID, { group: "app", limit: "default", session: "required" }, SIGNAL)).toBe(true);
  expect(await appOpen(failing, DID, { group: "app", limit: "default", session: "onboarding" }, SIGNAL)).toBe(false);
});

test("a_failed_read_offers_no_menus_and_logs_only_the_error_class", async () => {
  const world = deps(new TypeError(`connection lost for ${DID}`));
  expect(await appOpen(world.deps, DID, null, SIGNAL)).toBe(false);
  expect(world.lines.map((line) => [line.event, line.kind])).toEqual([["shell.account_read_failed", "TypeError"]]);
  expect(JSON.stringify(world.lines)).not.toContain(DID);
});
