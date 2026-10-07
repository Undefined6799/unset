// Toast (P1.24f): the sheet's Toast (components/Toast/README.md, index.d.ts) as built, no-JS form. Difference from the
// sheet's d.ts: `closeHref` (a link back to the same page) replaces `onClose`; the toast island (P1.24b,
// ToastClose.test.tsx) closes it in place. Keyboard, motion and theme checks run in P1.26's browser harness.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./Toast.module.css";
import { Toast } from "./Toast.tsx";

const page = safeHref("/settings", ["path"]) as SafeHref;

describe("Toast", () => {
  it("toast_live_region_from_load", () => {
    expect(renderToStaticMarkup(<Toast />)).toBe(`<div class="${styles.region}" role="status"></div>`);
    expect(renderToStaticMarkup(<Toast tone="err" />)).toBe(`<div class="${styles.region}" role="alert"></div>`);
  });

  it("toast_nojs_server_printed", () => {
    expect(renderToStaticMarkup(<Toast closeHref={page}>profile saved</Toast>)).toBe(
      `<div class="${styles.region}" role="status"><div class="${styles.toast}" id="_R_0_">${renderToStaticMarkup(<Tag status="ok" />)}` +
        `<span class="${styles.text}">profile saved</span><a class="${styles.close}" href="/settings">` +
        `${renderToStaticMarkup(<Icon name="close" size={16} label="Dismiss" />)}</a></div></div>`,
    );
    expect(
      renderToStaticMarkup(
        <Toast inline tone="info">
          copied
        </Toast>,
      ),
    ).toContain(`class="${styles.region} ${styles.inline}" role="status"><div class="${styles.toast}" id="`);
  });

  it("toast_never_auto_hides", () => {
    const css = readFileSync(join(import.meta.dirname, "Toast.module.css"), "utf8");
    expect(css).not.toMatch(/animation|transition/);
    for (const file of ["Toast.tsx", "ToastClose.tsx"])
      expect(readFileSync(join(import.meta.dirname, file), "utf8"), file).not.toMatch(
        /setTimeout|setInterval|useEffect/,
      );
  });
});
