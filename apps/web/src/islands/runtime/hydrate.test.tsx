// @vitest-environment jsdom
// The bootstrap's isolation (P1.23; the Playwright pair bootstrap_isolates_failure and csp_no_violations runs in
// P1.26 on a production build): one island failing to load, read or validate never stops another from hydrating.
import { defineIsland, type IslandDefinition } from "@unset/shared-ui";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { hydrateIslands, type IslandLoaders } from "./hydrate.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Counter({ start }: { start: number }) {
  return <output>{start}</output>;
}
const counter = defineIsland(Counter, {
  propsSchema: (v): v is { start: number } => typeof (v as { start?: unknown }).start === "number",
});

/** An island's server markup (what renderToString writes for Counter) and its props script, built node by node. */
function addIsland(name: string, id: string, props: string): void {
  const container = document.createElement("div");
  container.dataset.island = name;
  container.dataset.islandId = id;
  const output = document.createElement("output");
  output.textContent = "1";
  container.append(output);
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = id;
  script.textContent = props;
  document.body.append(container, script);
}

const loaders = (entries: Record<string, () => Promise<IslandDefinition>>): IslandLoaders =>
  new Map(Object.entries(entries));
const hydrated: Element[] = [];
const spyHydrate: typeof hydrateRoot = (element, children, options) => {
  hydrated.push(element as Element);
  return hydrateRoot(element, children, options);
};

afterEach(() => {
  document.body.replaceChildren();
  hydrated.length = 0;
  vi.restoreAllMocks();
});

test("server_markup_matches_counter", () => {
  addIsland("counter", "i1", "{}");
  expect(document.querySelector("[data-island]")?.innerHTML).toBe(renderToString(<Counter start={1} />));
});

test("bootstrap_isolates_failure_unit", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  addIsland("broken", "i1", '{"start":1}');
  addIsland("counter", "i2", '{"start":1}');
  const load = loaders({
    broken: () => Promise.reject(new Error("404 after a deploy")),
    counter: () => Promise.resolve(counter),
  });
  await act(() => hydrateIslands(document, load, spyHydrate));
  expect(hydrated.map((element) => element.getAttribute("data-island"))).toEqual(["counter"]);
  expect(error.mock.calls.map((call) => [call[0], call[1]])).toEqual([["island.static", "broken"]]);
});

test("bootstrap_leaves_static_on_bad_props", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  addIsland("counter", "i1", "not json");
  addIsland("counter", "i2", '{"start":"one"}');
  addIsland("unknown", "i3", '{"start":1}');
  addIsland("counter", "i4", '{"start":1}');
  await act(() => hydrateIslands(document, loaders({ counter: () => Promise.resolve(counter) }), spyHydrate));
  expect(hydrated.map((element) => element.getAttribute("data-island-id"))).toEqual(["i4"]);
  expect(document.querySelectorAll("output")).toHaveLength(4);
});
