// The web's page CSPs (ADR 0054 decision 4), pinned by value: a change to any policy shows here as a changed string.
// P1.21c: these are byte for byte what web sent before the Hono-era copy in shared/http/csp was deleted.
import { describe, expect, test } from "vitest";
import { narrowed, STATIC_CSP, zeroScriptCsp } from "./csp.ts";

const ORIGIN = "https://unset.sh";
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
    expect(narrowed(KIT, ORIGIN)).toBe(
      "default-src 'none'; script-src https://unset.sh/_app/ 'sha256-abc='; style-src https://unset.sh/_app/; font-src https://unset.sh/fonts/; img-src 'self'; connect-src 'self'",
    );
  });

  test("narrowed_frames_only_the_chat_door", () => {
    // The chat box (ADR 0115): app pages may frame the chat door's origin and web's own chat sign-in, which the shell
    // points the box's frame at, and nothing else.
    const frames = "https://unset.cc https://unset.sh/chat/sign-in";
    expect(narrowed(KIT, ORIGIN, frames)).toBe(
      "default-src 'none'; script-src https://unset.sh/_app/ 'sha256-abc='; style-src https://unset.sh/_app/; font-src https://unset.sh/fonts/; img-src 'self'; connect-src 'self'; frame-src https://unset.cc https://unset.sh/chat/sign-in",
    );
  });

  test("narrowed_keeps_frame_ancestors_none", () => {
    // After a redirect frame-src checks no path (CSP3 "Paths and Redirects"), so when the box's hop ends on another
    // web page (/login, /welcome/chat) only that page's own frame-ancestors 'none' and X-Frame-Options: DENY keep it
    // out of the frame (gate.test.ts every_response_carries_the_security_headers). Never relax either.
    const kit = `${KIT}; frame-ancestors 'none'`;
    expect(narrowed(kit, ORIGIN, "https://unset.cc")).toContain("frame-ancestors 'none'");
  });

  test("no_unsafe_tokens", () => {
    for (const [group, csp] of Object.entries(zeroScriptCsp(ORIGIN))) {
      for (const token of UNSAFE) expect(csp.includes(token), `${group} contains ${token}`).toBe(false);
      expect(csp, group).toContain("frame-ancestors 'none'");
    }
  });
});
