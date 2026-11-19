import { describe, expect, test } from "vitest";
import { DISCOVERABILITY_LIMITS, parseDiscoverabilityForm } from "./discoverability.ts";

const form = (fields: Record<string, string>) => new URLSearchParams(fields);

describe("parseDiscoverabilityForm", () => {
  test("nothing_ticked_is_all_off", () => {
    expect(parseDiscoverabilityForm(form({ title: "", description: "" }))).toEqual({
      ok: true,
      value: { searchEngines: false, aiSearch: false, title: "", description: "" },
    });
  });

  test("switches_and_trimmed_text", () => {
    const parsed = parseDiscoverabilityForm(
      form({ searchEngines: "on", aiSearch: "on", title: "  Mara Lind ", description: "Designer" }),
    );
    expect(parsed).toEqual({
      ok: true,
      value: { searchEngines: true, aiSearch: true, title: "Mara Lind", description: "Designer" },
    });
  });

  test("lengths_count_code_points", () => {
    const max = "é".repeat(DISCOVERABILITY_LIMITS.title);
    expect(parseDiscoverabilityForm(form({ title: max })).ok).toBe(true);
    expect(parseDiscoverabilityForm(form({ title: `${max}x` }))).toEqual({
      ok: false,
      field: "title",
      code: "profile.too_long",
    });
    expect(parseDiscoverabilityForm(form({ description: "x".repeat(201) }))).toMatchObject({ field: "description" });
  });

  test("refuses_what_the_form_never_sends", () => {
    for (const bad of [
      form({ searchEngines: "true" }),
      form({ other: "x" }),
      new URLSearchParams("title=a&title=b"),
      form({ title: "two\nlines" }),
      form({ description: "tab\there" }),
    ])
      expect(parseDiscoverabilityForm(bad).ok).toBe(false);
  });
});
