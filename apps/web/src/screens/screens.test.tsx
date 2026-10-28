// P2.05 (screens/Login.tsx, screens/LoginContinue.tsx): the sign-in pages, rendered through the render entry exactly as
// the web server renders them. The form posts with no script; the continue page moves on by a meta refresh.
import type { SafeHref } from "@unset/shared-ui";
import { describe, expect, test } from "vitest";
import { type Assets, renderPage, screens } from "../../render.tsx";

const ASSETS: Assets = {
  origin: "https://unset.test",
  manifest: {
    boot: "assets/boot.js",
    styles: [],
    fonts: [],
    icons: { favicon: "assets/icon.png", appleTouch: "assets/touch.png" },
    islands: new Map(),
  },
};
const html = (body: Parameters<typeof renderPage>[0]["body"]) =>
  renderPage({
    prefs: { htmlAttrs: { lang: "en" }, colorScheme: "dark light" },
    assets: ASSETS,
    env: "test",
    title: "T",
    body,
    islands: "on",
  }).html;
const LOGIN = { next: null, error: null, pdsHost: "pds.example", close: "/" };

/** Every start tag named `name`, each as its attribute map (attribute order is the renderer's, not part of the test). */
function tags(page: string, name: string): Record<string, string>[] {
  return [...page.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "g"))].map((match) =>
    Object.fromEntries([...(match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
}

describe("login screen", () => {
  // P2.05r: one button to our PDS's sign-in page and no handle field.
  test("login_form_posts_only_the_chooser", () => {
    const page = html(screens.login({ ...LOGIN, next: "/me" }));
    expect(tags(page, "form")).toEqual([{ action: "/login", method: "post" }]);
    expect(tags(page, "input")).toEqual([{ type: "hidden", name: "next", value: "/me" }]);
    const buttons = tags(page, "button").map(({ type, name, value }) => ({ type, name, value }));
    expect(buttons).toEqual([{ type: "submit", name: "intent", value: "chooser" }]);
    expect(page).toContain(">Sign in with AtProto</button>");
    expect(page).toContain("<strong>pds.example</strong>");
    expect(page).toContain("only place you type your password");
    // Zero JavaScript: no island ran, so no script of any kind.
    expect(page).not.toContain("<script");
  });

  // P2.05m (Alex, 2026-10-23: "the sign in should only be a modal"): the page is one box in the Modal's look over a
  // scrim, drawn with no script. With no script it cannot trap focus, so it is a named region, not an aria-modal
  // dialog, and Close goes home, since `next` is often the protected page that sent the visitor here.
  test("login_is_one_modal_box", () => {
    const page = html(screens.login({ ...LOGIN, next: "/did" }));
    expect(tags(page, "section")).toEqual([{ "aria-labelledby": "sign-in-title", class: expect.any(String) }]);
    expect(page).not.toMatch(/role="dialog"|aria-modal/);
    expect(page).toContain('<h1 id="sign-in-title"');
    expect(page.match(/<main/g)).toHaveLength(1);
    expect(tags(page, "a")).toEqual([expect.objectContaining({ href: "/" })]);
    expect(page).toMatch(/<a [^>]*href="\/"[^>]*>Close<\/a>/);
    // The route picks where Close goes (login_close_goes_back_to_the_page_before); the screen prints it.
    expect(html(screens.login({ ...LOGIN, close: "/legal/terms" }))).toMatch(/href="\/legal\/terms"[^>]*>Close</);
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
  test("signed_out_is_one_box_asking_about_the_pds", () => {
    // P2.08s (Alex, 2026-10-23 13:15Z): one Sign out, then a box asks whether to sign out of the atproto account too.
    const page = html(screens.signedOut({ issuer: "https://pds.example", ours: true }));
    expect(page).toContain('<section aria-labelledby="signed-out-title"');
    expect(page).toMatch(/<h1 id="signed-out-title"[^>]*>You are signed out of unset<\/h1>/);
    expect(page).toContain("Also sign out of your atproto account?");
    expect(page).toContain("Apps you allowed stay signed in until you remove them there.");
    expect(page).toContain(
      "You are going to pds.example, our sign-in server; it is the only place you type your password",
    );
    expect(page).toContain(">Your account on pds.example<span");
    // The sheet's standalone Link, like the account choice above it (Link README).
    expect(page).toMatch(/href="\/"[^>]*>No thanks<svg/);
    expect(tags(page, "a").map((a) => a.href)).toEqual(["https://pds.example/account", "/"]);
    expect(page).not.toContain("<script");
  });

  test("pdsAccountLink.own_vs_foreign", () => {
    const own = html(screens.signedOut({ issuer: "https://pds.test", ours: true }));
    expect(own).toContain("https://pds.test/account");
    expect(own).toContain("You are going to pds.test, our sign-in server; it is the only place you type your password");
    expect(own).toContain(">Your account on pds.test<span");
    const foreign = html(screens.signedOut({ issuer: "https://pds.example", ours: false }));
    expect(tags(foreign, "a").map((a) => a.href)).toEqual(["https://pds.example/", "/"]);
    expect(foreign).toContain("your sign-in server (pds.example)");
    expect(foreign).not.toContain("only place you type your password");
  });

  test("pdsAccountLink_opens_the_sign_in_server_in_a_new_tab", () => {
    // P2.08k (Alex, 2026-10-28: "when we go on the pds it just opens another tab"): unset.sh stays open behind it.
    for (const ours of [true, false]) {
      const page = html(screens.signedOut({ issuer: "https://pds.example", ours }));
      const [account] = tags(page, "a");
      expect(account).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
      expect(page).toContain('<span class="visually-hidden"> (opens in a new tab)</span>');
    }
    expect(tags(html(screens.signedOut({ issuer: "https://pds.example", ours: true })), "a")[1]).not.toHaveProperty(
      "target",
    );
  });

  test("pdsAccountLink_refuses_a_non_https_issuer", () => {
    for (const issuer of ["http://pds.example", "javascript:alert(1)", "not a url"]) {
      const page = html(screens.signedOut({ issuer, ours: false }));
      expect(tags(page, "a").map((a) => a.href)).toEqual(["/"]);
    }
  });
});

describe("me screen", () => {
  const DID = `did:plc:${"a".repeat(24)}`;
  const OURS = { issuer: "https://pds.example", ours: true };

  test("me_shows_the_account_and_sign_out", () => {
    const page = html(screens.me({ handle: "alice.pds.example", did: DID, handleUnavailable: false, ...OURS }));
    expect(page).toContain("alice.pds.example");
    expect(page).toContain(`<code>${DID}</code>`);
    // P2.08d: one sign-out form, for this browser; "Sign out everywhere" is removed.
    expect(tags(page, "form")).toEqual([{ method: "post", action: "/logout" }]);
    expect(page).toContain(">Sign out</button>");
    expect(page).not.toContain('name="confirm"');
    expect(page).not.toContain("Sign out everywhere");
    // P2.13c: the Edit profile link, then the account link.
    expect(tags(page, "a").map((a) => a.href)).toEqual(["/settings/profile", "https://pds.example/account"]);
    expect(page).toContain(">Your account on pds.example<span");
    expect(page).not.toContain("could not check your handle");
    expect(page).not.toContain("<script");
  });

  test("me_links_the_recorded_foreign_issuer", () => {
    // P2.08b: the account link follows the issuer recorded at sign-in, so an account on another PDS is sent there.
    const page = html(
      screens.me({
        handle: "alice.pds.example",
        did: DID,
        handleUnavailable: false,
        issuer: "https://pds.example",
        ours: false,
      }),
    );
    expect(tags(page, "a").map((a) => a.href)).toEqual(["/settings/profile", "https://pds.example/"]);
    expect(page).toContain("your sign-in server (pds.example)");
    expect(page).not.toContain("only place you type your password");
  });

  test("me_without_a_recorded_issuer_shows_no_account_link", () => {
    const page = html(
      screens.me({ handle: "alice.pds.example", did: DID, handleUnavailable: false, issuer: null, ours: false }),
    );
    expect(tags(page, "a").map((a) => a.href)).toEqual(["/settings/profile"]);
  });

  test("me_says_when_the_handle_could_not_be_checked", () => {
    const page = html(screens.me({ handle: "handle.invalid", did: DID, handleUnavailable: true, ...OURS }));
    expect(page).toContain("handle.invalid");
    expect(page).toContain("We could not check your handle just now");
  });
});

describe("verify email screen", () => {
  test("confirmed_email_continues_to_the_self_profile_shortcut", () => {
    const page = html(screens.verifyEmail({ state: "confirmed", pdsHost: "pds.example" }));
    expect(tags(page, "a").map((a) => a.href)).toEqual(["/did"]);
  });

  test("unconfirmed_email_opens_the_account_in_a_new_tab_and_checks_here", () => {
    // P2.08k: the member confirms in the new tab, then comes back to this one to check again.
    const page = html(screens.verifyEmail({ state: "unconfirmed", pdsHost: "pds.example" }));
    const links = tags(page, "a");
    expect(links.map((a) => a.href)).toEqual(["https://pds.example/account", "/verify-email"]);
    expect(links[0]).toMatchObject({ target: "_blank" });
    expect(links[1]).not.toHaveProperty("target");
    expect(page).toContain("Confirm your email in the new tab, then come back here.");
  });
});
