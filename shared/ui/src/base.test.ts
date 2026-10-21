// base.css read as text: the layer and token rules are the P1.21 guard's and lint's; these check what base.css itself
// promises. The rendered checks (forced colours, no-JS forms) run in P1.26's Playwright harness.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("./base.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every rule whose selector list is exactly `selector`. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blocks = [...css.matchAll(new RegExp(`(?:^|[}{])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  return blocks.map((m) => m[1] ?? "").join("\n");
}

/** The block of the first `@media <query>` rule, braces included. */
function media(query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return "";
}

describe("base.css", () => {
  test("base_has_no_classes_except_visually_hidden", () => {
    const classes = [...css.matchAll(/(?<![\w-])\.([A-Za-z_-][\w-]*)/g)].map((m) => m[1]);
    expect(new Set(classes)).toEqual(new Set(["visually-hidden"]));
  });

  test("checkbox_drawn_as_text", () => {
    expect(declarations('input[type="checkbox"],\n  input[type="radio"]')).toMatch(/appearance:\s*none/);
    expect(declarations('input[type="checkbox"]::before')).toMatch(/content:\s*"\[ \]"/);
    // U+00D7 sits centred between the brackets where a letter x sits low (Alex 2026-10-21, sheet Checkbox).
    expect(declarations('input[type="checkbox"]:checked::before')).toMatch(/content:\s*"\[\\D7\]"/);
    expect(declarations('input[type="radio"]::before')).toMatch(/content:\s*"\( \)"/);
    expect(declarations('input[type="radio"]:checked::before')).toMatch(/content:\s*"\(•\)"/);
  });

  test("button_drawn_as_outline", () => {
    // The sheet's outline Button (approved 2026-10-21): an `ink` label, a `line-strong` edge (::before) and the page's
    // ground inside it (::after, 1px in), with `radius-sm` corners.
    const button = declarations('button,\n  input[type="submit"]');
    expect(button).toMatch(/color:\s*var\(--color-ink\)/);
    expect(button).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(declarations("button:not([class])::before")).toMatch(/background-color:\s*var\(--base-edge\)/);
    expect(declarations("button:not([class])::after")).toMatch(/inset:\s*var\(--base-hairline\)/);
    expect(declarations("button:not([class])::after")).toMatch(/background-color:\s*var\(--base-fill\)/);
    expect(button).toMatch(/--base-fill:\s*var\(--surface\);/);
  });

  test("fields_take_radius_sm", () => {
    const fields =
      'input:not([type="checkbox"], [type="radio"], [type="submit"], [type="button"], [type="reset"], [type="hidden"]),\n  textarea,\n  select';
    expect(declarations(fields)).toMatch(/border-radius:\s*var\(--radius-sm\)/);
  });

  test("forced_colors_restores_native_controls", () => {
    const block = media("(forced-colors: active)");
    expect(block).toMatch(/input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{\s*appearance:\s*auto/);
    expect(block).toMatch(/::before\s*\{\s*content:\s*none/);
  });

  test("focus_ring_on_every_interactive_element", () => {
    expect(declarations(":focus-visible")).toMatch(
      /outline:\s*2px solid var\(--color-focus\);\s*outline-offset:\s*2px/,
    );
  });

  test("reduced_motion_disables_animation", () => {
    const block = media("(prefers-reduced-motion: reduce)");
    expect(block).toMatch(/animation:\s*none/);
    expect(block).toMatch(/transition:\s*none/);
  });

  test("interactive_targets_at_least_24px", () => {
    expect(declarations("a,\n  button,\n  input,\n  select,\n  textarea,\n  summary")).toMatch(/min-height:\s*24px/);
  });
});
