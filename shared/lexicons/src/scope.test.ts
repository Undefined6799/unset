import { describe, expect, test } from "vitest";
import { scopeString, scopeStringFallback } from "./scope.ts";

// Every scope the app requests beside its permission set, copied byte for byte. ADR 0039: only what a shipped feature
// uses; each later feature adds its own scope in its own PR, which costs every member one re-consent.
const OUTSIDE_THE_SET = ["blob:image/*", "account:email?action=read"].join(" ");

describe("scope strings", () => {
  test("scope_string_pinned", () => {
    expect(scopeString()).toBe(`atproto include:sh.unset.authApp ${OUTSIDE_THE_SET}`);
  });

  test("scope_fallback_pinned", () => {
    // The permission set written out as granular scopes, for a PDS without permission-set support.
    expect(scopeStringFallback()).toBe(
      `atproto repo:sh.unset.profile repo:sh.unset.section repo:sh.unset.follow?action=create&action=delete ${OUTSIDE_THE_SET}`,
    );
  });

  test("scopes_request_no_bluesky_or_unused_scope", () => {
    // ADR 0039: no Bluesky collection, AppView call, video upload or report scope until the feature that uses it ships.
    for (const scope of [scopeString(), scopeStringFallback()]) {
      expect(scope).not.toMatch(/app\.bsky\.|blob:video|rpc:/);
    }
  });

  test("scopes_never_request_identity_status_or_transition", () => {
    for (const scope of [scopeString(), scopeStringFallback()]) {
      expect(scope).not.toMatch(/identity:|account:status|transition:/);
    }
  });
});
