// Input and the shared field parts (P1.24): the sheet's Input (components/Input/README.md, index.d.ts) as built.
// Differences from the sheet's d.ts: `label` is required (a runtime check refuses an empty one); `type` is limited to
// the text kinds; a hint and an error can show together, each with its own id; no `onChange` is needed (no JS).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fieldIds } from "./field.tsx";
import styles from "./Input.module.css";
import { Input } from "./Input.tsx";

describe("Input", () => {
  it("field_aria_wiring", () => {
    const html = renderToStaticMarkup(
      <Input id="handle" name="handle" label="Handle" hint="your domain" error="taken" />,
    );
    expect(html).toContain(`<label id="handle-label" class="${styles.label}" for="handle">Handle</label>`);
    expect(html).toMatch(
      /<input aria-describedby="handle-hint handle-error" aria-invalid="true" id="handle" [^>]*name="handle"/,
    );
    expect(html).toContain('<p id="handle-hint"');
    expect(html).toMatch(/<p id="handle-error" class="[^"]+"><span class="[^"]+">\[err\]<\/span> taken<\/p>/);
  });

  it("field_without_messages_has_no_aria", () => {
    const html = renderToStaticMarkup(<Input id="q" label="Search" type="search" />);
    expect(html).toBe(
      `<div class="${styles.field}"><label id="q-label" class="${styles.label}" for="q">Search</label>` +
        `<input id="q" type="search" class="${styles.control}"/></div>`,
    );
  });

  it("field_generates_an_id_when_none_given", () => {
    const html = renderToStaticMarkup(<Input label="Name" hint="shown on your profile" />);
    const id = /<input aria-describedby="([^"]+)-hint" id="([^"]+)"/.exec(html);
    expect(id?.[1]).toBe(id?.[2]);
    expect(html).toContain(`for="${id?.[2]}"`);
  });

  it("field_requires_a_label", () => {
    expect(() => fieldIds("x", "", { error: "required" })).toThrow("a field needs a visible label");
    // @ts-expect-error: a field with no label is a type error too.
    expect(() => renderToStaticMarkup(<Input error="required" />)).toThrow("a field needs a visible label");
  });
});
