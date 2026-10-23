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
  test("signed_out_links_to_the_pds_account_and_sign_in", () => {
    const page = html(screens.signedOut({ issuer: "https://pds.example", ours: true }));
    expect(page).toContain("You are signed out");
    expect(page).toContain(
      "You are going to pds.example, our sign-in server; it is the only place you type your password",
    );
    expect(page).toContain("On a shared computer, sign out there too.");
    const links = tags(page, "a").map((a) => a.href);
    expect(links).toEqual(["https://pds.example/account", "/login"]);
    expect(page).not.toContain("<script");
  });

  test("pdsAccountLink.own_vs_foreign", () => {
    const own = html(screens.signedOut({ issuer: "https://pds.test", ours: true }));
    expect(own).toContain("https://pds.test/account");
    expect(own).toContain("You are going to pds.test, our sign-in server; it is the only place you type your password");
    expect(own).toContain(">Your account on pds.test<svg");
    const foreign = html(screens.signedOut({ issuer: "https://pds.example", ours: false }));
    expect(tags(foreign, "a").map((a) => a.href)).toEqual(["https://pds.example/", "/login"]);
    expect(foreign).toContain("your sign-in server (pds.example)");
    expect(foreign).not.toContain("only place you type your password");
  });

  test("pdsAccountLink_refuses_a_non_https_issuer", () => {
    for (const issuer of ["http://pds.example", "javascript:alert(1)", "not a url"]) {
      const page = html(screens.signedOut({ issuer, ours: false }));
      expect(tags(page, "a").map((a) => a.href)).toEqual(["/login"]);
    }
  });
});

describe("profile screen", () => {
  const ALICE_ID = { did: "did:plc:alice123456789abcdefgh", handle: "alice.pds.example", verified: true };
  const ALICE = {
    displayName: "Alice Moreau",
    headline: "Designer and front-end developer.",
    location: "Toronto, Ontario",
    website: "https://alice.example/",
    readme: "## About me\nI make tools.\n:::\n## My projects\n- [Tidy](https://alice.example/tidy)",
    links: "https://github.com/alicem",
  };

  test("profile_shows_the_name_facts_and_readme", () => {
    const page = html(screens.profile({ ...ALICE_ID, handleUnavailable: false, profile: ALICE }));
    expect(page).toContain(">Alice Moreau</h1>");
    expect(page).toContain(">@alice.pds.example</p>");
    expect(page).toContain("Verified");
    expect(page).toContain("Toronto, Ontario");
    expect(page).toContain('title="did:plc:alice123456789abcdefgh"');
    expect(tags(page, "a").map((a) => a.href)).toEqual([
      "https://alice.example/",
      "https://github.com/alicem",
      "https://alice.example/tidy",
    ]);
    expect(page).toContain(">About me</h2>");
    // No sign-out here: the account details are on Settings › Account (P2.13c).
    expect(tags(page, "form")).toEqual([]);
    expect(page).not.toContain("<code>");
    // The owner's editing island hydrates over the same markup; its server render has no pencils or draft box.
    expect(page).toContain('data-island="profile-editor"');
    const markup = page.replace(/<script[^>]*>[^<]*<\/script>/g, "");
    expect(markup).not.toContain("Edit display name");
    expect(markup).not.toContain("Draft");
  });

  test("profile_without_one_published_is_the_editor_on_an_empty_page", () => {
    const page = html(screens.profile({ ...ALICE_ID, handleUnavailable: false, profile: null }));
    expect(page).toMatch(/<h1[^>]*><span[^>]*>Display name<\/span><\/h1>/);
    expect(page).toContain('data-island="profile-editor"');
  });

  test("profile_never_links_an_unsafe_website", () => {
    const profile = { ...ALICE, website: "javascript:alert(1)", readme: "", links: "javascript:alert(2)" };
    const page = html(screens.profile({ ...ALICE_ID, handleUnavailable: false, profile }));
    expect(page).not.toContain('href="javascript:');
    expect(tags(page, "a").map((a) => a.href)).toEqual([]);
  });

  test("profile_says_when_it_could_not_be_loaded", () => {
    const page = html(screens.profile({ ...ALICE_ID, handleUnavailable: false, profile: "unavailable" }));
    expect(page).toContain("We could not load your profile just now.");
  });

  test("profile_says_when_the_handle_could_not_be_checked", () => {
    const page = html(
      screens.profile({
        did: ALICE_ID.did,
        handle: "handle.invalid",
        verified: false,
        handleUnavailable: true,
        profile: null,
      }),
    );
    expect(page).toContain("handle.invalid");
    expect(page).toContain("We could not check your handle just now");
  });
});

describe("verify email screen", () => {
  test("confirmed_email_continues_to_the_self_profile_shortcut", () => {
    const page = html(screens.verifyEmail({ state: "confirmed", pdsHost: "pds.example" }));
    expect(tags(page, "a").map((a) => a.href)).toEqual(["/did"]);
  });
});
