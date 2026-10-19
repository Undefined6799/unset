// Page responses with P1.22's preferences wired in (P1.23 carries the two document tests P1.22 moved here).
import { Island, renderPage } from "@unset/apps-web";
import { defineIsland, type IslandDefinition } from "@unset/shared-islands";
import { createLogger } from "@unset/shared-log";
import { parse } from "parse5";
import { expect, test } from "vitest";
import { THEME_COOKIE } from "../prefs/theme.ts";
import { elements, textContent } from "./fixtures/html.ts";
import { type PageDeps, pageResponse } from "./page.ts";

const lines: Record<string, unknown>[] = [];
const echo = defineIsland(({ text }: { text: string }) => <p>{text}</p>, {
  propsSchema: (v): v is { text: string } => typeof (v as { text?: unknown }).text === "string",
});
const deps = (env: PageDeps["env"]): PageDeps => ({
  build: {
    manifest: {
      boot: "assets/boot-1.js",
      styles: [],
      fonts: [],
      icons: { favicon: "assets/icon.png", appleTouch: "assets/touch.png" },
      islands: new Map([["echo", ["assets/echo-2.js"]]]),
    },
    files: new Map(),
  },
  render: renderPage,
  assetsOrigin: "https://unset.test",
  env,
  log: createLogger({
    service: "http",
    commit: "c".repeat(40),
    env: "test",
    write: (line) => lines.push(JSON.parse(line)),
  }),
  islands: new Map<string, IslandDefinition>([["echo", echo]]),
});
const request = (cookie?: string) =>
  new Request("https://unset.test/", { headers: cookie === undefined ? {} : { cookie } });

test("public_page_ignores_pref_cookies", async () => {
  const page = (cookie?: string) =>
    pageResponse(deps("test"), { group: "profile", request: request(cookie), title: "P", body: <p>hi</p> });
  const plain = page();
  const themed = page(`${THEME_COOKIE}=dark`);
  expect(await themed.text()).toBe(await plain.text());
  expect([...themed.headers]).toEqual([...plain.headers]);
  expect(plain.headers.get("vary")).toBeNull();
});

test("app_page_applies_theme_and_varies", async () => {
  const response = pageResponse(deps("test"), {
    group: "app",
    request: request(`${THEME_COOKIE}=light`),
    title: "A",
    body: null,
  });
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const html = await response.text();
  expect(html).toContain('<html lang="en" data-theme="light">');
  expect(html).toContain('<meta name="color-scheme" content="light"/>');
});

test("island_props_too_large_prod_logs_name_only", async () => {
  lines.length = 0;
  const body = <Island name="echo" props={{ text: "secret ".repeat(3000) }} />;
  const html = await pageResponse(deps("prod"), { group: "app", request: request(), title: "A", body }).text();
  expect(html).not.toContain("<script");
  const logged = lines.filter((line) => line.event === "island.props_too_large");
  expect(logged).toHaveLength(1);
  expect(logged[0]?.island).toBe("echo");
  expect(JSON.stringify(logged)).not.toContain("secret");
});

test("shell_navigation_uses_only_the_route_supplied_identity", async () => {
  const accountPath = `/did:plc:${"a".repeat(24)}`;
  const response = pageResponse(deps("test"), {
    group: "app",
    request: new Request(`https://unset.test${accountPath}?active=settings&accountName=Mallory&accountPath=/evil`, {
      headers: { cookie: "accountName=Mallory" },
    }),
    title: "Account",
    body: null,
    islands: "off",
    shell: { navigation: { active: "account", accountName: "Alice", accountPath } },
  });
  const document = parse(await response.text());
  const account = elements(elements(document, "nav")[0], "a", { href: accountPath, "aria-current": "page" })[0];
  expect(account).toBeDefined();
  const initials = elements(account, "span", { "aria-hidden": "true" }).map(textContent);
  expect(initials).toContain("A");
  expect(textContent(document)).not.toContain("Mallory");
  expect(elements(document, "a", { href: "/evil" })).toHaveLength(0);
  expect(elements(document, "script")).toHaveLength(0);
});

test("default_shell_footer_prefs", async () => {
  type Spec = { group: "app" | "public"; cookie?: string; navigation?: true; feed?: true; path?: string };
  const page = async (spec: Spec) => {
    const response = pageResponse(deps("test"), {
      group: spec.group,
      request: new Request(`https://unset.test${spec.path ?? "/signed-out"}?return=%2Fevil&theme=light`, {
        headers: spec.cookie === undefined ? {} : { cookie: spec.cookie },
      }),
      title: "Sign in",
      body: null,
      islands: "off",
      shell: spec.navigation ? { navigation: { active: "home" } } : spec.feed ? { feed: true } : {},
    });
    const document = parse(await response.text());
    return { document, forms: elements(document, "form", { method: "post", action: "/prefs/theme" }) };
  };
  const themed = await page({ group: "app", cookie: `${THEME_COOKIE}=dark` });
  expect(themed.forms).toHaveLength(1);
  const form = themed.forms[0];
  expect(elements(elements(themed.document, "footer")[0], "form")).toEqual(themed.forms);
  expect(elements(form, "input", { type: "radio", name: "theme" })).toHaveLength(3);
  expect(elements(form, "input", { type: "radio", value: "dark", checked: "" })).toHaveLength(1);
  expect(elements(form, "input", { checked: "" })).toHaveLength(1);
  // Only the page's path goes back: the query's `return` and `theme` are never echoed.
  expect(elements(form, "input", { type: "hidden", name: "return", value: "/signed-out" })).toHaveLength(1);
  expect(elements(form, "input", { type: "hidden" })).toHaveLength(1);
  expect(elements(form, "button", { type: "submit" })).toHaveLength(1);
  // The kit refuses /login as a return target (shared/http/returnPath.ts DENIED_TARGETS), so the form goes home.
  const login = await page({ group: "app", path: "/login" });
  expect(elements(login.forms[0], "input", { type: "hidden", name: "return", value: "/" })).toHaveLength(1);
  const system = await page({ group: "app" });
  expect(elements(system.forms[0], "input", { value: "system", checked: "" })).toHaveLength(1);
  // A tampered or repeated theme cookie reads as system, and only enum values reach the form.
  for (const cookie of [
    `${THEME_COOKIE}=blue`,
    `${THEME_COOKIE}=%22%3E%3Cb%3E`,
    `${THEME_COOKIE}=dark; ${THEME_COOKIE}=light`,
  ]) {
    const tampered = await page({ group: "app", cookie });
    expect(elements(tampered.forms[0], "input", { checked: "" }).map((radio) => radio.attrs)).toEqual(
      elements(system.forms[0], "input", { checked: "" }).map((radio) => radio.attrs),
    );
    expect(elements(tampered.document, "b")).toHaveLength(0);
  }
  // Legal pages are public: the theme follows the system there, so no form (phase-1.md:4886-4889).
  expect((await page({ group: "public", path: "/legal/terms" })).forms).toHaveLength(0);
  expect((await page({ group: "app", navigation: true })).forms).toHaveLength(0);
  // A feed page reaches feed mode through pageResponse: no footer, so no form.
  const feed = await page({ group: "app", feed: true });
  expect(elements(feed.document, "footer")).toHaveLength(0);
  expect(feed.forms).toHaveLength(0);
});
