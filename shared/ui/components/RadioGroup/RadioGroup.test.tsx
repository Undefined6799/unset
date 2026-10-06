// RadioGroup (P1.24): the sheet's RadioGroup (components/RadioGroup/README.md, index.d.ts) as built. Differences from
// the sheet's d.ts: `label` and `name` are required; no `value`/`onChange` (no JS); nothing is chosen without
// `defaultValue` (the sheet's draft picks the first option); `hint`, `error`, `required` and `id` added.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RadioGroup } from "./RadioGroup.tsx";

const options = [
  { value: "dark", label: "dark" },
  { value: "light", label: "light" },
];

describe("RadioGroup", () => {
  it("radiogroup_fieldset_legend", () => {
    const html = renderToStaticMarkup(
      <RadioGroup id="theme" name="theme" label="Theme" options={options} defaultValue="light" />,
    );
    expect(html).toMatch(/^<fieldset id="theme" class="[^"]+"><legend>Theme<\/legend>/);
    expect(html).toContain('<input type="radio" name="theme" value="dark"/>');
    expect(html).toContain('<input type="radio" name="theme" checked="" value="light"/>');
  });

  it("radiogroup_field_wiring", () => {
    const html = renderToStaticMarkup(<RadioGroup id="t" name="t" label="Theme" options={options} error="pick one" />);
    expect(html).toMatch(/^<fieldset aria-describedby="t-error" aria-invalid="true" id="t"/);
    expect(html).not.toMatch(/checked/);
  });
});
