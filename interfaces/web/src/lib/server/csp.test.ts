// The web's page CSPs (ADR 0054 decision 4), pinned by value: a change to any policy shows here as a changed string.
// P1.21c: these are byte for byte what web sent before the Hono-era copy in shared/http/csp was deleted.
import { describe, expect, test } from "vitest";
import { narrowed, STATIC_CSP, withMediaImages, zeroScriptCsp } from "./csp.ts";

const ORIGIN = "https://unset.sh";
const MEDIA = "https://usercontent.unset.site";
/** A header shaped like the one SvelteKit builds from kit.csp in vite.config.ts. */
const KIT =
  "default-src 'none'; script-src 'self' 'sha256-abc='; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'";
const UNSAFE = ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", "nonce-", "data:", " https: ", "*"];

describe("web csp", () => {
  test("zero_script_groups_pinned", () => {
    expect(zeroScriptCsp(ORIGIN)).toEqual({
      public:
        "default-src 'none'; img-src https://unset.sh/_app/; style-src https://unset.sh/_app/; font-src https://unset.sh/fonts/; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; manifest-src 'self'",
      static: "default-src 'none'; frame-ancestors 'none'",
      app: "default-src 'none'; frame-ancestors 'none'",
    });
    expect(STATIC_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  test("narrowed_replaces_self_only_in_file_directives", () => {
    expect(narrowed(KIT, ORIGIN, MEDIA)).toBe(
      "default-src 'none'; script-src https://unset.sh/_app/ 'sha256-abc='; style-src https://unset.sh/_app/; font-src https://unset.sh/fonts/; img-src 'self' https://usercontent.unset.site; connect-src 'self'",
    );
  });

  // Book P2.19, ADR 0070 point 5: the owner's previews load from the media origin, so the app group's img-src names it;
  // nothing else changes, and the public group (no script, no member pictures yet) keeps its own.
  test("app_img_src_names_the_media_origin_only", () => {
    expect(withMediaImages(KIT, MEDIA)).toBe(
      "default-src 'none'; script-src 'self' 'sha256-abc='; style-src 'self'; font-src 'self'; img-src 'self' https://usercontent.unset.site; connect-src 'self'",
    );
    expect(withMediaImages("default-src 'none'", MEDIA)).toBe(
      "default-src 'none'; img-src https://usercontent.unset.site",
    );
    expect(zeroScriptCsp(ORIGIN).public).not.toContain(MEDIA);
  });

  test("no_unsafe_tokens", () => {
    for (const [group, csp] of Object.entries(zeroScriptCsp(ORIGIN))) {
      for (const token of UNSAFE) expect(csp.includes(token), `${group} contains ${token}`).toBe(false);
      expect(csp, group).toContain("frame-ancestors 'none'");
    }
  });
});
