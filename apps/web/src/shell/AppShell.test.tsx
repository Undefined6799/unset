// @vitest-environment jsdom
// P1.25 (shell/AppShell.tsx, shell/head.tsx, errors/ErrorPage.tsx): the shell through the render entry, as the web
// server renders it. A zero-JS page must work as plain HTML, so these read the markup only.

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  // P2.13e: one left drawer (Figma 135:806, 135:858, 135:935), opened by the header's menu button on desktop and the
  // floating bar's on phones; it closes with its X, Escape or a press outside (native popover).
  test("drawer_opens_from_the_header_and_the_bar_and_closes_with_its_x", () => {
    const document = core("settings");
    const drawer = document.querySelector('[popover="auto"]');
    expect(drawer?.id).toBe("core-menu");
    const toggles = [...document.querySelectorAll('[popovertarget="core-menu"][popovertargetaction="toggle"]')];
    expect(toggles).toHaveLength(2);
    expect(toggles[0]?.closest("header")).not.toBeNull();
    expect(drawer?.querySelector('[popovertargetaction="hide"]')?.getAttribute("aria-label")).toBe("Close menu");
    expect(drawer?.querySelector('[href="/settings/profile"][aria-current="page"]')).not.toBeNull();
  });

  const signedIn = (theme: "dark" | "light" | "system") =>
    new DOMParser().parseFromString(
      render({
        shell: {
          error: null,
          noindex: true,
          navigation: { active: "settings", accountPath: "/did:plc:abc" },
          prefs: { theme, returnTo: "/settings/account" },
        },
      }),
      "text/html",
    );

  test("drawer_signs_this_browser_out_under_a_line", () => {
    const drawer = signedIn("system").querySelector('[popover="auto"]');
    const form = drawer?.querySelector('form[action="/logout"]');
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.querySelector('button[type="submit"]')?.textContent).toBe("Sign out");
    expect(core().querySelector('form[action="/logout"]')).toBeNull();
  });

  test("drawer_theme_picker_posts_dark_device_or_light", () => {
    const drawer = signedIn("light").querySelector('[popover="auto"]');
    const form = drawer?.lastElementChild?.querySelector('form[action="/prefs/theme"]');
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.querySelector('input[type="hidden"][name="return"]')?.getAttribute("value")).toBe("/settings/account");
    expect(form?.querySelector("fieldset > legend")?.textContent).toBe("Theme");
    const buttons = [...(form?.querySelectorAll("button") ?? [])];
    expect(
      buttons.map((b) => [b.type, b.name, b.value, b.getAttribute("aria-label"), b.getAttribute("aria-pressed")]),
    ).toEqual([
      ["submit", "theme", "dark", "Dark", "false"],
      ["submit", "theme", "system", "System", "false"],
      ["submit", "theme", "light", "Light", "true"],
    ]);
    expect(buttons.every((b) => b.querySelector("svg") !== null)).toBe(true);
    expect(core().querySelector('form[action="/prefs/theme"]')).toBeNull();
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

  test("shell_footer_links", () => {
    const footer = render().split("<footer")[1] ?? "";
    for (const href of ["/", "/login", "/legal/terms", "/legal/privacy", "/legal/domains"]) {
      expect(footer).toContain(`href="${href}"`);
    }
  });

  // Alex 2026-10-23: the footer always starts at least one screen down, so a short page shows no footer until scrolled.
  test("shell_footer_starts_below_the_first_screen", () => {
    const document = new DOMParser().parseFromString(render(), "text/html");
    const page = document.querySelector("main")?.parentElement;
    expect(page?.querySelector(":scope > header")).not.toBeNull();
    expect(page?.nextElementSibling?.tagName).toBe("FOOTER");
    const css = readFileSync(join(import.meta.dirname, "../screens/CoreShell.module.css"), "utf8");
    expect(/\.page\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/min-height:\s*100dvh/);
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
