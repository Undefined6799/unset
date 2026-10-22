// Button (P1.24): the sheet's Button (components/Button/README.md, index.d.ts) as built. Differences from the sheet's
// d.ts: `as="a"` with `href: SafeHref | null` replaces `href?: string`; `next` adds the trailing icon;
// required native callback/ref/ARIA fields support hydrated consumers; form fields support server posts.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { safeHref } from "../../safe-href.ts";
import styles from "./Button.module.css";
import { Button } from "./Button.tsx";

// The outline's fill (approved 2026-10-21): decoration only, so empty and hidden from assistive tech.
const FILL = `<span class="${styles.fill}" aria-hidden="true"></span>`;

describe("Button", () => {
  it("button_renders_single_style", () => {
    const plain = renderToStaticMarkup(<Button>Save</Button>);
    const submit = renderToStaticMarkup(<Button type="submit">Save</Button>);
    const link = renderToStaticMarkup(
      <Button as="a" href={safeHref("/settings", ["path"])}>
        Settings
      </Button>,
    );
    for (const html of [plain, submit, link]) expect(html).toMatch(new RegExp(`^<(button|a) class="${styles.root}"`));
    expect(link).toBe(`<a class="${styles.root}" href="/settings">${FILL}Settings</a>`);
  });

  it("button_type_default_button", () => {
    expect(renderToStaticMarkup(<Button>Save</Button>)).toBe(
      `<button class="${styles.root}" type="button">${FILL}Save</button>`,
    );
    expect(renderToStaticMarkup(<Button type="submit">Save</Button>)).toMatch(/ type="submit"/);
  });

  it("button_safehref_rejects_javascript", () => {
    // safeHref refuses the link, so the button renders disabled and the page gets no href at all.
    const html = renderToStaticMarkup(
      <Button as="a" href={safeHref("javascript:alert(1)", ["https:", "path"])}>
        Open
      </Button>,
    );
    expect(html).toBe(`<button class="${styles.root}" type="button" disabled="">${FILL}Open</button>`);
    expect(html).not.toMatch(/href|javascript/);
  });

  it("button_disabled_states", () => {
    expect(renderToStaticMarkup(<Button disabled>Save</Button>)).toMatch(/ disabled=""/);
    const link = renderToStaticMarkup(
      <Button as="a" href={safeHref("/x", ["path"])} disabled>
        Go
      </Button>,
    );
    expect(link).not.toMatch(/href/);
    expect(link).toMatch(/^<button [^>]*disabled=""/);
  });

  it("button_outline_edge_and_fill", () => {
    const css = readFileSync(new URL("./Button.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/--button-edge:\s*var\(--color-line-strong\)/);
    expect(css).toMatch(/--button-radius:\s*var\(--radius-sm\)/);
    expect(css).toMatch(/--button-fill:\s*var\(--surface\);/);
    expect(css).toMatch(/color:\s*var\(--color-ink\);/);
  });

  it("next_icon_on_button", () => {
    const html = renderToStaticMarkup(<Button next>Continue</Button>);
    expect(html).toMatch(
      /^<button [^>]*><span [^>]*><\/span>Continue<svg width="16" height="16" [^>]*aria-hidden="true" focusable="false">/,
    );
    expect(html).not.toContain("→");
  });
});
