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
    // The favicons wait for the sheet to name their files (book P1.25, "Favicons"); no SVG favicon either way.
    expect(html).not.toMatch(/rel="(?:icon|apple-touch-icon)"/);
    expect(html).not.toContain('name="robots"');
  });

  test("shell_noindex_meta", () => {
    expect(head(render({ shell: { error: null, noindex: true } }))).toContain(
      '<meta name="robots" content="noindex"/>',
    );
  });

  test("shell_landmarks_in_order", () => {
    const html = render();
    const order = ['href="#main"', "<header", '<main id="main">', "<h1>unset.sh</h1>", "</main>", "<footer"];
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
    for (const href of ["/", "/login", "/legal/terms", "/legal/privacy"]) expect(footer).toContain(`href="${href}"`);
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

describe("legal placeholders", () => {
  test("legal_placeholders_say_in_preparation", () => {
    for (const document of ["terms", "privacy"] as const) {
      const html = render({ body: screens.legal({ document }) });
      expect(html).toContain(document === "terms" ? "<h1>Terms of service</h1>" : "<h1>Privacy notice</h1>");
      expect(html).toContain("This document is in preparation.");
    }
  });
});
