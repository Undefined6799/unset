// P2.05 (screens/Login.tsx, screens/LoginContinue.tsx): the sign-in pages, rendered through the render entry exactly as
// the web server renders them. The form posts with no script; the continue page moves on by a meta refresh.
import type { SafeHref } from "@unset/shared-ui";
import { describe, expect, test } from "vitest";
import { type Assets, renderPage, screens } from "../../render.tsx";

const ASSETS: Assets = {
  origin: "https://unset.test",
  manifest: { boot: "assets/boot.js", styles: [], islands: new Map() },
};
const html = (body: Parameters<typeof renderPage>[0]["body"]) =>
  renderPage({
    prefs: { htmlAttrs: { lang: "en" }, colorScheme: "dark light" },
    assets: ASSETS,
    env: "test",
    title: "T",
    body,
  }).html;
const LOGIN = { handle: "", next: null, error: null, pdsHost: "pds.example", handleDomain: "pds.example" };

/** Every start tag named `name`, each as its attribute map (attribute order is the renderer's, not part of the test). */
function tags(page: string, name: string): Record<string, string>[] {
  return [...page.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "g"))].map((match) =>
    Object.fromEntries([...(match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
}

describe("login screen", () => {
  test("login_form_posts_handle_and_intent", () => {
    const page = html(screens.login({ ...LOGIN, handle: "alice", next: "/me" }));
    expect(tags(page, "form")).toEqual([{ action: "/login", method: "post" }]);
    const inputs = tags(page, "input");
    expect(inputs.find((input) => input.name === "handle")).toMatchObject({
      value: "alice",
      placeholder: "alice.pds.example",
    });
    expect(inputs.find((input) => input.name === "next")).toEqual({ type: "hidden", name: "next", value: "/me" });
    const buttons = tags(page, "button").map(({ type, name, value }) => ({ type, name, value }));
    expect(buttons).toEqual([
      { type: "submit", name: "intent", value: "login" },
      { type: "submit", name: "intent", value: "chooser" },
    ]);
    expect(page).toContain(">Sign in</button>");
    expect(page).toContain(">Use pds.example sign-in</button>");
    // Zero JavaScript: no island ran, so no script of any kind.
    expect(page).not.toContain("<script");
  });

  test("login_without_next_has_no_hidden_field", () => {
    expect(html(screens.login(LOGIN))).not.toContain('name="next"');
  });

  test("login_error_shows_the_catalog_text", () => {
    const page = html(screens.login({ ...LOGIN, error: "login.handle_not_found" }));
    expect(page).toContain('role="alert"');
    expect(page).toContain("No account uses that handle.");
    expect(html(screens.login(LOGIN))).not.toContain('role="alert"');
  });
});

describe("continue screen", () => {
  const target = "https://pds.example/oauth/authorize?client_id=x&request_uri=urn%3Areq" as SafeHref;

  test("continue_refreshes_to_the_target", () => {
    const page = html(screens.loginContinue({ target, host: "pds.example", ours: false }));
    expect(page).toContain(
      '<meta http-equiv="refresh" content="0;url=https://pds.example/oauth/authorize?client_id=x&amp;request_uri=urn%3Areq"/>',
    );
    expect(page).toContain("You are going to <strong>pds.example</strong>");
    expect(page).toMatch(
      /<a[^>]*href="https:\/\/pds.example\/oauth\/authorize\?client_id=x&amp;request_uri=urn%3Areq"/,
    );
    expect(page).toContain("Continue to pds.example");
    expect(page).not.toContain("only place you type your password");
    expect(page).not.toContain("<script");
  });

  test("continue_names_our_sign_in_server", () => {
    const page = html(screens.loginContinue({ target, host: "pds.example", ours: true }));
    expect(page).toContain("our sign-in server; it is the only place you type your password");
  });

  test("continue_escapes_the_target", () => {
    // A SafeHref is already a parsed URL; the renderer escapes it again inside the attribute.
    const page = html(
      screens.loginContinue({ target: 'https://a.example/x?q="<b>' as SafeHref, host: "a.example", ours: false }),
    );
    expect(page).toContain('content="0;url=https://a.example/x?q=&quot;&lt;b&gt;"');
    expect(page).not.toContain('q="<b>');
  });
});

describe("signed-out screen", () => {
  test("signed_out_links_to_the_pds_account_and_sign_in", () => {
    const page = html(screens.signedOut({ pdsHost: "pds.example" }));
    expect(page).toContain("You are signed out");
    expect(page).toContain("our sign-in server; it is the only place you type your password");
    const links = tags(page, "a").map((a) => a.href);
    expect(links).toEqual(["https://pds.example/account", "/login"]);
    expect(page).not.toContain("<script");
  });
});

describe("me screen", () => {
  const DID = `did:plc:${"a".repeat(24)}`;

  test("me_shows_the_account_and_sign_out", () => {
    const page = html(
      screens.me({ handle: "alice.pds.example", did: DID, handleUnavailable: false, pdsHost: "pds.example" }),
    );
    expect(page).toContain("alice.pds.example");
    expect(page).toContain(`<code>${DID}</code>`);
    expect(tags(page, "form")).toEqual([{ method: "post", action: "/logout" }]);
    expect(page).toContain(">Sign out</button>");
    expect(tags(page, "a").map((a) => a.href)).toEqual(["https://pds.example/account"]);
    expect(page).not.toContain("could not check your handle");
    expect(page).not.toContain("<script");
  });

  test("me_says_when_the_handle_could_not_be_checked", () => {
    const page = html(
      screens.me({ handle: "handle.invalid", did: DID, handleUnavailable: true, pdsHost: "pds.example" }),
    );
    expect(page).toContain("handle.invalid");
    expect(page).toContain("We could not check your handle just now");
  });
});
