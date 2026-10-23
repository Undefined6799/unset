// @vitest-environment jsdom
// P1.25 (shell/AppShell.tsx, shell/head.tsx, errors/ErrorPage.tsx): the shell through the render entry, as the web
// server renders it. A zero-JS page must work as plain HTML, so these read the markup only.

import { describe, expect, test } from "vitest";
import { type Assets, type PageInput, renderPage, screens } from "../../render.tsx";

const ASSETS: Assets = {
  origin: "https://assets.unset.test",
  manifest: {
    boot: "assets/boot-1.js",
    styles: ["assets/styles-2.css"],
    fonts: ["assets/Display-3.woff2", "assets/Mono-4.woff2"],
    icons: { favicon: "assets/unset-favicon-32-6.png", appleTouch: "assets/unset-apple-touch-icon-7.png" },
    islands: new Map([["header-menu", ["assets/header-menu-5.js"]]]),
  },
};

function render(input: Partial<PageInput> = {}): string {
  return renderPage({
    prefs: { htmlAttrs: { lang: "en" }, colorScheme: "dark light" },
    assets: ASSETS,
    env: "test",
    title: "T",
    body: screens.home(),
    islands: "off",
    shell: { error: null, noindex: false },
    ...input,
  }).html;
}
const head = (html: string) => html.slice(0, html.indexOf("</head>"));

describe("core shell", () => {
  const core = (active: "home" | "account" | "settings" = "home", accountName?: string, accountPath?: string) =>
    new DOMParser().parseFromString(
      render({
        shell: {
          error: null,
          noindex: false,
          navigation: {
            active,
            ...(accountName === undefined ? {} : { accountName }),
            ...(accountPath === undefined ? {} : { accountPath }),
          },
        },
      }),
      "text/html",
    );

  test("home_is_bare_with_one_main_and_a_skip_link", () => {
    const document = core();
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelector("main")?.children).toHaveLength(1);
    expect(document.querySelector("main > h1.visually-hidden")?.textContent).toBe("Home");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("#main");
    expect(document.querySelector("header a")?.getAttribute("href")).toBe("/");
    expect(document.querySelector("footer")).toBeNull();
  });

  test("navigation_uses_real_account_and_protected_settings_routes", () => {
    const document = core();
    expect(document.querySelectorAll('a[href="/did"]')).toHaveLength(2);
    expect(document.querySelector('a[href="/me"]')).toBeNull();
    expect(document.querySelector('a[href="/settings/profile"]')).not.toBeNull();
    expect(document.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/");
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("[data-island]")).toBeNull();
  });

  test("phone_menu_has_native_dismiss_and_settings_without_new_scripts", () => {
    const document = core("settings");
    const popup = document.querySelector('[popover="auto"]');
    expect(popup).not.toBeNull();
    // The popup has no Close control (Alex, 2026-10-21, approved-extensions.json Navigation): the native auto
    // popover dismisses on Escape and outside press, and its toggle names it.
    expect(document.querySelector('[popovertargetaction="hide"]')).toBeNull();
    expect(document.querySelector(`[popovertarget="${popup?.id}"]`)).not.toBeNull();
    expect(popup?.querySelector('[href="/settings/profile"][aria-current="page"]')).not.toBeNull();
  });

  test("signed_in_avatar_uses_only_the_supplied_name", () => {
    const document = core("account", "member.unset.test", "/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa");
    const links = document.querySelectorAll('[href="/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"][aria-current="page"]');
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toContain("M");
    expect(document.querySelector('a[href="/me"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Demo Member");
  });

  test.each(["https://other.example/profile", "//other.example/profile", "javascript:alert(1)"])(
    "account_destination_rejects_non_path_%s",
    (accountPath) => {
      expect(() => core("account", undefined, accountPath)).toThrow("shell link is not a path");
    },
  );
});

describe("app shell", () => {
  test("shell_head_contents", () => {
    const html = head(render({ prefs: { htmlAttrs: { lang: "en" }, colorScheme: "light" } }));
    expect(html.match(/<link rel="preload"[^>]*>/g)).toEqual([
      '<link rel="preload" as="font" type="font/woff2" crossorigin="" href="https://assets.unset.test/assets/Display-3.woff2"/>',
      '<link rel="preload" as="font" type="font/woff2" crossorigin="" href="https://assets.unset.test/assets/Mono-4.woff2"/>',
    ]);
    expect(html).toContain('<link rel="stylesheet" href="https://assets.unset.test/assets/styles-2.css"/>');
    expect(html).toContain('<meta name="color-scheme" content="light"/>');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1"/>');
    // The two PNG icons, as the sheet's Logos README links them; the SVG favicon waits for the sheet (P1.25a).
    expect(html.match(/<link rel="(?:icon|apple-touch-icon)"[^>]*>/g)).toEqual([
      '<link rel="icon" href="https://assets.unset.test/assets/unset-favicon-32-6.png" sizes="32x32" type="image/png"/>',
      '<link rel="apple-touch-icon" href="https://assets.unset.test/assets/unset-apple-touch-icon-7.png"/>',
    ]);
    expect(html).not.toContain("image/svg+xml");
    expect(html).not.toContain('name="robots"');
  });

  test("shell_noindex_meta", () => {
    expect(head(render({ shell: { error: null, noindex: true } }))).toContain(
      '<meta name="robots" content="noindex"/>',
    );
  });

  test("shell_landmarks_in_order", () => {
    const html = render();
    const order = [
      'href="#main"',
      "<header",
      '<main id="main">',
      '<h1 class="visually-hidden">Home</h1>',
      "</main>",
      "<footer",
    ];
    const at = order.map((piece) => html.indexOf(piece));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // The skip link is the first focusable element of the body.
    expect(html.slice(html.indexOf("<body>")).match(/<(?:a|button|input|summary)\b/)?.[0]).toBe("<a");
  });

  test("shell_zero_js", () => {
    // The Header carries an island slot; on an "off" page it renders static, with no marker, props or script.
    const html = render();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("modulepreload");
    expect(html).not.toContain("data-island");
  });

  test("header_menu_static_on_zero_js_pages", () => {
    const html = render();
    const menu = /<details[^>]*><summary[^>]*>menu.*?<\/details>/.exec(html)?.[0] ?? "";
    expect(menu).toContain('href="/login"');
    expect(menu).not.toContain(" open");
  });

  test("sign_in_opens_in_place_with_no_script", () => {
    // P2.05p: with the PDS named, the Header's Sign in opens the sign-in box over the page as a native popover, so
    // the visitor never leaves the page and Close or Escape leave them where they were.
    const html = render({
      shell: { error: null, noindex: false, signIn: { pdsHost: "pds.test", next: "/legal/terms" } },
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const box = doc.querySelector("#sign-in");
    expect(box?.getAttribute("popover")).toBe("auto");
    expect(box?.getAttribute("role")).toBe("dialog");
    expect(doc.getElementById(box?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Sign in");
    expect(box?.textContent).toContain("pds.test");
    const form = box?.querySelector("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/login");
    expect(form?.querySelector('input[name="next"]')?.getAttribute("value")).toBe("/legal/terms");
    const close = [...(box?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Close");
    expect(close?.getAttribute("popovertarget")).toBe("sign-in");
    expect(close?.getAttribute("popovertargetaction")).toBe("hide");
    const openers = [...doc.querySelectorAll('header button[popovertarget="sign-in"]')];
    expect(openers.length).toBeGreaterThan(0);
    expect(openers.every((b) => b.textContent === "Sign in")).toBe(true);
    expect(doc.querySelector('header a[href="/login"]')).toBeNull();
    expect(html).not.toContain("<script");
    expect(doc.querySelector("main #sign-in")).toBeNull();
  });

  test("sign_in_stays_a_link_without_the_pds", () => {
    const doc = new DOMParser().parseFromString(render(), "text/html");
    expect(doc.querySelector("#sign-in")).toBeNull();
    expect(doc.querySelector('header a[href="/login"]')).not.toBeNull();
  });

  test("shell_footer_links", () => {
    const footer = render().split("<footer")[1] ?? "";
    for (const href of ["/", "/login", "/legal/terms", "/legal/privacy", "/legal/domains"]) {
      expect(footer).toContain(`href="${href}"`);
    }
  });

  test("shell_feed_no_footer", () => {
    // A feed scrolls without end, so its footer links move into the header menu, which opens with no JS (P1.25f).
    // Through the render entry, as a route reaches it (ShellOptions.feed).
    const html = render({ shell: { error: null, noindex: false, feed: true } });
    expect(html).not.toContain("<footer");
    const menu = /<details[^>]*><summary[^>]*>menu.*?<\/details>/.exec(html)?.[0] ?? "";
    for (const href of ["/login", "/legal/terms", "/legal/privacy", "/legal/domains"]) {
      expect(menu, href).toContain(`href="${href}"`);
    }
    expect(menu).not.toContain(" open");
    expect(render()).toContain("<footer");
    // A page without the theme form renders no empty slot in the footer.
    expect(render()).not.toMatch(/class="slot_/);
  });

  test("error_param_known_code", () => {
    const html = render({ shell: { error: "csrf.denied", noindex: false } });
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("The form expired or came from another site. Reload the page and try again.");
  });

  test("error_param_none_no_callout", () => {
    expect(render()).not.toContain('role="alert"');
  });

  test("islands_on_page_hydrates_header_menu", () => {
    const html = render({ islands: "on" });
    expect(html).toContain('data-island="header-menu"');
    expect(html).toContain('<script type="module" src="https://assets.unset.test/assets/boot-1.js">');
  });

  test("no_shell_renders_the_screen_alone", () => {
    const html = renderPage({
      prefs: { htmlAttrs: { lang: "en" }, colorScheme: "dark light" },
      assets: ASSETS,
      env: "test",
      title: "T",
      body: <main>own</main>,
      islands: "off",
    }).html;
    expect(html).toContain("<body><main>own</main></body>");
  });
});

describe("error page", () => {
  test("error_page_shows_catalog_text_and_code", () => {
    const html = render({ body: screens.errorPage({ code: "http.not_found" }) });
    expect(html).toContain("<h1>That page does not exist.</h1>");
    expect(html).toContain("<code>http.not_found</code>");
    expect(html).toMatch(/<a href="\/" class="[^"]+">Go to the home page/);
    expect(html).not.toContain("Request id");
  });

  test("error_page_shows_request_id", () => {
    const reqId = "0b5f3c1e-9d2a-4c7b-8e6f-1a2b3c4d5e6f";
    const html = render({ body: screens.errorPage({ code: "internal.error", reqId }) });
    expect(html).toContain("<h1>Something went wrong on our side.</h1>");
    expect(html).toContain(`<code>${reqId}</code>`);
  });
});

const LEGAL_VALUES = {
  privacyOfficerTitle: "Officer",
  privacyOfficerContact: "contact",
  supportEmail: "support",
  pdsHost: "pds.example",
};

describe("legal placeholders", () => {
  test("legal_pages_open_with_the_placeholder_banner", () => {
    const banner = "This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice.";
    const heading = { terms: "Terms of service", privacy: "Privacy notice", domains: "Our domains" } as const;
    for (const document of ["terms", "privacy", "domains"] as const) {
      const html = render({ body: screens.legal({ document, values: LEGAL_VALUES }) });
      const main = html.slice(html.indexOf("<main"));
      expect(main.startsWith(`<main id="main"><p>${banner}</p>`)).toBe(true);
      expect(html).toContain(`<h1>${heading[document]}</h1>`);
      expect(html).not.toContain("in preparation");
    }
  });
});
