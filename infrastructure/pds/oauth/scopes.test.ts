// P2.04 (scopes.ts): what the client asks for and what a sign-in must have been granted. The strings themselves are
// P1.31's (shared/lexicons scope.ts, pinned there to plan §3); this file checks they parse and decides coverage.
import { scopeString, scopeStringFallback } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import { grantCovers, SCOPE_METADATA } from "./scopes.ts";

const tokens = (scope: string) => scope.split(" ");
const EXPANDED = scopeStringFallback();

describe("scopes", () => {
  test("scopes_parse_all", async () => {
    const { isAtprotoOauthScope } = await import("@atproto/oauth-scopes");
    // An authorization server drops a token it cannot parse without an error (@atproto/oauth-provider
    // request-manager.ts), so a token the pinned parser refuses would silently never be granted.
    expect(tokens(SCOPE_METADATA).filter((token) => !isAtprotoOauthScope(token))).toEqual([]);
    expect(SCOPE_METADATA).not.toMatch(/transition:/);
  });

  test("scopes_metadata_superset", () => {
    const metadata = new Set(tokens(SCOPE_METADATA));
    for (const token of [...tokens(scopeString()), ...tokens(scopeStringFallback())]) {
      expect(metadata.has(token), token).toBe(true);
    }
    expect(tokens(SCOPE_METADATA).length).toBe(metadata.size);
  });

  test("grantCovers_include_form", () => {
    expect(grantCovers(scopeString())).toEqual({ ok: true });
  });

  test("grantCovers_expanded_form", () => {
    expect(grantCovers(EXPANDED)).toEqual({ ok: true });
  });

  test("grantCovers_missing_email", () => {
    const withoutEmail = tokens(EXPANDED)
      .filter((token) => !token.startsWith("account:email"))
      .join(" ");
    expect(grantCovers(withoutEmail)).toEqual({ ok: false, missing: ["account:email?action=read"] });
  });

  test("grantCovers_missing_atproto_and_writes", () => {
    expect(grantCovers("repo:sh.unset.profile?action=create blob:image/*")).toEqual({
      ok: false,
      missing: [
        "atproto",
        "repo:sh.unset.profile?action=update",
        "repo:sh.unset.profile?action=delete",
        "repo:sh.unset.section?action=create",
        "repo:sh.unset.section?action=update",
        "repo:sh.unset.section?action=delete",
        "account:email?action=read",
      ],
    });
  });

  test("grantCovers_image_wildcard", () => {
    // Review on #921: a server that narrows blob:image/* to one type leaves the other accepted types unusable.
    const narrowed = tokens(EXPANDED)
      .map((token) => (token === "blob:image/*" ? "blob:image/png" : token))
      .join(" ");
    expect(grantCovers(narrowed)).toEqual({ ok: false, missing: ["blob:image/*"] });
  });

  test("grantCovers_include_of_another_set_grants_nothing", () => {
    const foreign = tokens(scopeString())
      .map((token) => (token.startsWith("include:") ? "include:com.example.other" : token))
      .join(" ");
    expect(grantCovers(foreign)).toMatchObject({ ok: false });
  });
});
