// Textarea (P1.24): the sheet's Textarea (components/Textarea/README.md, index.d.ts) as built. Differences from the
// sheet's d.ts: as Input (`label` required; hint and error together).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import inputStyles from "../Input/Input.module.css";
import { Textarea } from "./Textarea.tsx";

describe("Textarea", () => {
  it("textarea_four_rows_and_field_wiring", () => {
    const html = renderToStaticMarkup(<Textarea id="bio" name="bio" label="Bio" error="too long" />);
    expect(html).toMatch(
      new RegExp(
        `<textarea name="bio" aria-describedby="bio-error" aria-invalid="true" id="bio" rows="4" class="${inputStyles.control}"></textarea>`,
      ),
    );
    expect(renderToStaticMarkup(<Textarea id="b" label="Bio" rows={8} />)).toMatch(/ rows="8"/);
  });
});
