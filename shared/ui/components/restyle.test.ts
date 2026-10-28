// The design sheet's 2026-10-21 restyle as the component CSS states it (sheet v81; approved by Alex 2026-10-21):
// buttons, fields, menus and the Modal box take `radius-sm`; every surface that holds a Button names itself in
// --surface, so the outline Button's fill matches what is behind it; the Footer sits one step below the page.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(text: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[}{\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text)?.[1] ?? "";
}

describe("restyle 2026-10-21", () => {
  test("menus_fields_and_modal_take_radius_sm", () => {
    const select = css("./Select/Select.module.css");
    expect(rule(select, ".combobox")).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(rule(select, ".list")).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    // P2.13e: the menu drawer comes out of the left edge, so only its right corners are rounded.
    expect(rule(css("./Navigation/Navigation.module.css"), ".drawer")).toMatch(
      /border-radius:\s*0 var\(--radius-sm\) var\(--radius-sm\) 0/,
    );
    expect(rule(css("./Header/Header.module.css"), ".panel")).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(rule(css("./Modal/Modal.module.css"), ".root")).toMatch(/border-radius:\s*var\(--radius-sm\)/);
  });

  test("surfaces_name_themselves_for_the_button_fill", () => {
    for (const [path, surface] of [
      ["./Card/Card.module.css", "surface-card"],
      ["./Callout/Callout.module.css", "surface-raised"],
      ["./CodeBlock/CodeBlock.module.css", "surface-raised"],
      ["./NewPosts/NewPosts.module.css", "surface-raised"],
      ["./Footer/Footer.module.css", "surface-sunken"],
      // A dialog moves to the top layer but still inherits from where it sits in the DOM, so it names its own ground.
      ["./Modal/Modal.module.css", "ground"],
    ] as const)
      expect(rule(css(path), ".root"), path).toMatch(new RegExp(`--surface:\\s*var\\(--color-${surface}\\)`));
  });

  test("footer_one_step_below_the_page", () => {
    expect(rule(css("./Footer/Footer.module.css"), ".root")).toMatch(
      /background-color:\s*var\(--color-surface-sunken\)/,
    );
  });
});
