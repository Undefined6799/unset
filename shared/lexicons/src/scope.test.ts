import { describe, expect, test } from "vitest";
import { scopeString, scopeStringFallback } from "./scope.ts";

// Plan §3 (docs/ai/PLAN.md, the "Granular permissions + permission sets" row): every scope the app requests, copied
// byte for byte. A scope added after launch costs every user a re-consent, so a change here is a plan change first.
const OUTSIDE_THE_SET = [
  "repo:app.bsky.feed.like?action=create&action=delete",
  "repo:app.bsky.feed.post",
  "repo:app.bsky.graph.follow",
  "repo:app.bsky.actor.profile",
  "blob:image/*",
  "blob:video/*",
  "account:email?action=read",
  "rpc:app.bsky.feed.getFeed?aud=did:web:api.bsky.app#bsky_appview",
  "rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app#bsky_appview",
  "rpc:app.bsky.feed.getPosts?aud=did:web:api.bsky.app#bsky_appview",
  "rpc:app.bsky.feed.getFeedGenerators?aud=did:web:api.bsky.app#bsky_appview",
  "rpc:app.bsky.feed.getPostThread?aud=did:web:api.bsky.app#bsky_appview",
  "rpc:com.atproto.moderation.createReport?aud=*",
].join(" ");

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

  test("scopes_never_request_identity_status_or_transition", () => {
    for (const scope of [scopeString(), scopeStringFallback()]) {
      expect(scope).not.toMatch(/identity:|account:status|transition:/);
    }
  });
});
