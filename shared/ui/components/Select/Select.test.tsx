// Select (P1.24): the sheet's Select (components/Select/README.md, index.d.ts) as built. Differences from the sheet:
// the native <select> with no JS (the listbox island, P1.24b, is in SelectListbox.test.tsx); no `value`/`onChange`
// (no JS); `label` is required.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "./Select.tsx";

const options = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];

describe("Select", () => {
  it("select_native", () => {
    const html = renderToStaticMarkup(
      <Select id="lang" name="lang" label="Language" options={options} defaultValue="fr" />,
    );
    expect(html).toMatch(/<select id="lang" name="lang" class="[^"]+">/);
    expect(html).toContain('<option value="en">English</option><option value="fr" selected="">Français</option>');
    expect(html).toMatch(/<span class="[^"]+" aria-hidden="true">▾<\/span>/);
    expect(html).not.toMatch(/role="listbox"|<script/);
  });

  it("select_placeholder_is_not_choosable", () => {
    const html = renderToStaticMarkup(<Select id="l" label="Language" options={options} placeholder="pick one" />);
    expect(html).toContain('<option value="" disabled="" selected="">pick one</option>');
  });

  it("select_field_wiring", () => {
    const html = renderToStaticMarkup(
      <Select id="l" label="Language" options={options} hint="for menus" error="required" />,
    );
    expect(html).toMatch(/<select aria-describedby="l-hint l-error" aria-invalid="true" id="l"/);
  });
});
