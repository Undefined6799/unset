// Checkbox (P1.24): the sheet's Checkbox (components/Checkbox/README.md, index.d.ts) as built. Differences from the
// sheet's d.ts: no `checked`/`onChange` (no JS; `defaultChecked` sets the first state); `hint`, `error`, `required`
// and `id` added for forms. The brackets are drawn by base.css on the real input, not by a separate span.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Checkbox.module.css";
import { Checkbox } from "./Checkbox.tsx";

describe("Checkbox", () => {
  it("checkbox_real_input_in_label", () => {
    const html = renderToStaticMarkup(<Checkbox id="n" name="notify" value="1" label="email me" defaultChecked />);
    expect(html).toBe(
      `<div class="${styles.root}"><label class="${styles.row}">` +
        '<input id="n" type="checkbox" name="notify" checked="" value="1"/><span>email me</span></label></div>',
    );
  });

  it("checkbox_field_wiring", () => {
    const html = renderToStaticMarkup(<Checkbox id="t" label="i accept" error="required" />);
    expect(html).toMatch(/<input aria-describedby="t-error" aria-invalid="true" id="t" type="checkbox"/);
    expect(html).toMatch(/<p id="t-error"/);
  });
});
