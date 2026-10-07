// IslandSlot with no provider (P1.24j; architecture record 2026-10-07-p124j-island-slots-and-styles-budget.md): the
// static path renders the island's server markup after the checks the hydrated path runs. The provider half,
// island_slot_with_provider_wraps_island, is in apps/web/render.test.tsx.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { defineIsland } from "./define.ts";
import { SerializeError } from "./props.ts";
import { IslandRendererContext, IslandSlot } from "./slot.tsx";

type Count = { n: number };
const isCount = (v: unknown): v is Count => typeof (v as Partial<Count> | null)?.n === "number";
const counter = defineIsland(({ n }: Count) => createElement("output", null, n), { propsSchema: isCount });
const small = defineIsland(({ n }: Count) => createElement("output", null, n), {
  propsSchema: isCount,
  maxPropsBytes: 4,
});

test("island_slot_without_provider_renders_static", () => {
  expect(renderToStaticMarkup(<IslandSlot name="counter" island={counter} props={{ n: 3 }} />)).toBe(
    "<output>3</output>",
  );
});

test("island_slot_static_checks_props", () => {
  const invalid = (props: unknown) => () =>
    renderToStaticMarkup(<IslandSlot name="counter" island={counter} props={props as Count} />);
  expect(invalid({ n: "3" })).toThrow(SerializeError);
  expect(invalid({ n: "3" })).toThrow("islands.props_invalid");
  // The schema passes, P1.10's serialiser refuses: a non-finite number, as on the hydrated path.
  expect(invalid({ n: Number.POSITIVE_INFINITY })).toThrow("islands.props_invalid");
  // Over the byte limit is not an error: production renders such an island static too.
  expect(renderToStaticMarkup(<IslandSlot name="small" island={small} props={{ n: 12345 }} />)).toBe(
    "<output>12345</output>",
  );
});

test("island_slot_props_refuse_react_nodes", () => {
  const withNode = defineIsland(({ text }: { text: string }) => text, {
    propsSchema: (v): v is { text: string } => typeof (v as { text?: unknown }).text === "string",
  });
  const node: ReactNode = <b>bold</b>;
  // @ts-expect-error a ReactNode is not a JSON value, so it never reaches an island's props
  const slot = <IslandSlot name="with-node" island={withNode} props={{ text: node }} />;
  expect(() => renderToStaticMarkup(slot)).toThrow("islands.props_invalid");
  // @ts-expect-error the props must be the island's own
  expect(() => renderToStaticMarkup(<IslandSlot name="counter" island={counter} props={{ m: 1 }} />)).toThrow();
});

test("island_slot_uses_the_provided_renderer", () => {
  const seen: unknown[] = [];
  const html = renderToStaticMarkup(
    <IslandRendererContext
      value={(name, island, props) => {
        seen.push([name, island, props]);
        return "hydrating";
      }}
    >
      <IslandSlot name="counter" island={counter} props={{ n: 3 }} />
    </IslandRendererContext>,
  );
  expect(html).toBe("hydrating");
  expect(seen).toEqual([["counter", counter, { n: 3 }]]);
});
