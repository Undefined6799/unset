// Page responses with P1.22's preferences wired in (P1.23 carries the two document tests P1.22 moved here).
import { Island } from "@unset/apps-web";
import { createLogger } from "@unset/shared-log";
import { defineIsland, type IslandDefinition } from "@unset/shared-ui";
import { expect, test } from "vitest";
import { THEME_COOKIE } from "../prefs/theme.ts";
import { type PageDeps, pageResponse } from "./page.ts";

const lines: Record<string, unknown>[] = [];
const echo = defineIsland(({ text }: { text: string }) => <p>{text}</p>, {
  propsSchema: (v): v is { text: string } => typeof (v as { text?: unknown }).text === "string",
});
const deps = (env: PageDeps["env"]): PageDeps => ({
  build: {
    manifest: { boot: "assets/boot-1.js", islands: new Map([["echo", ["assets/echo-2.js"]]]) },
    files: new Map(),
  },
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
