// Switch (P1.24s): the sheet's Switch (components/Switch/README.md, v37 and v45, index.d.ts) as built. Differences
// from the sheet's d.ts: no `checked`/`onChange` (no JS; `defaultChecked` sets the first state); `id` added. The
// "on"/"off" drawing follows the real input through CSS (`:checked + .track`), checked in P1.26's browser harness.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Switch.module.css";
import { Switch } from "./Switch.tsx";

describe("Switch", () => {
  it("switch_real_checkbox_with_role", () => {
    const html = renderToStaticMarkup(<Switch id="email" name="showEmail" label="show my email" defaultChecked />);
    expect(html).toBe(
      `<label class="${styles.root}" for="email"><span>show my email</span>` +
        `<input id="email" class="${styles.input}" type="checkbox" role="switch" name="showEmail" checked=""/>` +
        `<span class="${styles.track}" aria-hidden="true"><span class="${styles.on}">[──◉] on</span>` +
        `<span class="${styles.off}">[○──] off</span></span></label>`,
    );
    expect(html).not.toMatch(/aria-checked|<script/);
  });
});
