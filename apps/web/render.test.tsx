// Server render of pages and islands (P1.23's Done-when list), through the render entry interfaces/http calls.
import { defineIsland, type IslandDefinition, type JsonValue } from "@unset/shared-ui";
import { describe, expect, test } from "vitest";
import {
  type Assets,
  Island,
  IslandPropsInvalid,
  IslandPropsTooLarge,
  IslandUnknown,
  type PageInput,
  renderPage,
} from "./render.tsx";

const hasN = (v: unknown): v is { n: number } => typeof (v as { n?: unknown }).n === "number";
const has =
  <K extends string>(key: K) =>
  (v: unknown): v is Record<K, JsonValue> =>
    typeof v === "object" && v !== null && key in v;
const ISLANDS = new Map<string, IslandDefinition>([
  ["demo", defineIsland(({ n }: { n: number }) => <button type="button">{n}</button>, { propsSchema: hasN })],
  ["echo", defineIsland(({ text }: { text: JsonValue }) => <p>{String(text)}</p>, { propsSchema: has("text") })],
  [
    "labels",
    defineIsland(({ pairs }: { pairs: JsonValue }) => <ul>{JSON.stringify(pairs)}</ul>, { propsSchema: has("pairs") }),
  ],
]);
const ASSETS: Assets = {
  origin: "https://unset.test",
  manifest: {
    boot: "assets/boot-1.js",
    islands: new Map([
      ["demo", ["assets/demo-2.js", "assets/boot-1.js"]],
      ["echo", ["assets/echo-3.js", "assets/shared-4.js"]],
    ]),
  },
};

function render(body: PageInput["body"], env: PageInput["env"] = "test") {
  return renderPage({
    prefs: { htmlAttrs: { lang: "en" }, colorScheme: "dark light" },
    assets: ASSETS,
    env,
    title: "Test",
    body,
    islands: ISLANDS,
  });
}
const scripts = (html: string) => html.match(/<script[^>]*>/g) ?? [];

describe("islands on the server", () => {
  test("island_renders_props_script", () => {
    const { html } = render(<Island name="demo" props={{ a: 1, n: 1 }} />);
    expect(html).toContain('<div data-island="demo" data-island-id="i1"><button type="button">1</button></div>');
    expect(html).toContain('<script type="application/json" id="i1">{"a":1,"n":1}</script>');
    expect(scripts(html)).toContain('<script type="module" src="https://unset.test/assets/boot-1.js">');
    expect(html.match(/rel="modulepreload"/g)).toHaveLength(1);
    expect(html).toContain('<link rel="modulepreload" href="https://unset.test/assets/demo-2.js"/>');
  });

  test("island_none_no_script", () => {
    const { html } = render(<p>static</p>);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("modulepreload");
  });

  test("document_no_inline_script_or_style", () => {
    const { html } = render(
      <>
        <Island name="demo" props={{ n: 1 }} />
        <Island name="echo" props={{ text: "x" }} />
      </>,
    );
    // Every script is either external (src) or JSON data; nothing carries a style attribute or element.
    for (const tag of scripts(html)) expect(tag).toMatch(/ src="|type="application\/json"/);
    expect(html).not.toMatch(/<style|\sstyle=|\son[a-z]+=/i);
  });

  test("island_props_xss_escaped", () => {
    const { html } = render(<Island name="echo" props={{ text: "</script><script>alert(1)</script>" }} />);
    const json = /<script type="application\/json" id="i1">(.*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(json).not.toMatch(/<|>/);
    expect(JSON.parse(json)).toEqual({ text: "</script><script>alert(1)</script>" });
    expect(html.match(/<script/g)).toHaveLength(2); // the props script and the bootstrap, no injected one
  });

  test("island_ids_unique_per_response", () => {
    const page = (
      <>
        <Island name="demo" props={{ n: 1 }} />
        <Island name="demo" props={{ n: 2 }} />
        <Island name="echo" props={{ text: "x" }} />
      </>
    );
    const { html } = render(page);
    expect([...html.matchAll(/data-island-id="([^"]+)"/g)].map((m) => m[1])).toEqual(["i1", "i2", "i3"]);
    expect(html.match(/rel="modulepreload"/g)).toHaveLength(3); // demo-2, echo-3, shared-4: each once
    expect(render(page).html).toBe(html); // the counter restarts per page
  });

  test("island_unknown_throws", () => {
    expect(() => render(<Island name="nope" props={{}} />)).toThrow(IslandUnknown);
  });

  test("island_props_invalid_throws", () => {
    expect(() => render(<Island name="demo" props={{ n: "1" }} />)).toThrow(IslandPropsInvalid);
  });

  test("island_props_user_keys_as_pairs", () => {
    const labels = { "</script>": "a", "a b": "b" };
    expect(() => render(<Island name="labels" props={{ pairs: labels }} />)).toThrow(IslandPropsInvalid);
    const pairs = Object.entries(labels);
    const { html } = render(<Island name="labels" props={{ pairs }} />);
    const json = /id="i1">(.*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(JSON.parse(json)).toEqual({ pairs });
  });

  test("island_props_too_large_dev_throws", () => {
    const text = "x".repeat(20_000);
    expect(() => render(<Island name="echo" props={{ text }} />, "test")).toThrow(IslandPropsTooLarge);
    expect(() => render(<Island name="echo" props={{ text }} />, "development")).toThrow(IslandPropsTooLarge);
  });

  test("island_props_too_large_prod", () => {
    const { html, tooLarge } = render(<Island name="echo" props={{ text: "x".repeat(20_000) }} />, "production");
    expect(tooLarge).toEqual(["echo"]);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("data-island");
    expect(html).toContain(`<div><p>${"x".repeat(20_000)}</p></div>`); // it stays as static markup
  });
});

describe("document", () => {
  test("document_uses_prefs", () => {
    const { html } = renderPage({
      prefs: { htmlAttrs: { lang: "en", "data-theme": "dark" }, colorScheme: "dark" },
      assets: ASSETS,
      env: "test",
      title: "A & B",
      body: null,
      islands: ISLANDS,
    });
    expect(html.startsWith('<!doctype html><html lang="en" data-theme="dark"><head><meta charSet="utf-8"/>')).toBe(
      true,
    );
    expect(html).toContain('<meta name="color-scheme" content="dark"/>');
    expect(html).toContain("<title>A &amp; B</title>");
  });
});
