// Callout (P1.24a): the sheet's Callout (components/Callout/README.md, index.d.ts) as built. Difference from the
// sheet's d.ts: no `glyph` override, since no page needs one yet and the sheet forbids emoji there; the four tone
// glyphs stay text, as the sheet draws them.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Callout.module.css";
import { Callout, type CalloutProps } from "./Callout.tsx";

describe("Callout", () => {
  it("callout_tones_match_sheet", () => {
    const tones: Record<NonNullable<CalloutProps["tone"]>, [string, string]> = {
      info: ["i", "note"],
      note: ["*", "note"],
      success: ["+", "note"],
      danger: ["!", "alert"],
    };
    for (const [tone, [glyph, role]] of Object.entries(tones))
      expect(renderToStaticMarkup(<Callout tone={tone as keyof typeof tones} title="Saved" />)).toBe(
        `<div class="${styles.root} ${styles[tone]}" role="${role}">` +
          `<span class="${styles.glyph}" aria-hidden="true">${glyph}</span>` +
          `<div class="${styles.body}"><div class="${styles.title}">Saved</div></div></div>`,
      );
    // @ts-expect-error: a fifth tone is a type error.
    expect(renderToStaticMarkup(<Callout tone="warning" />)).toContain("role=");
  });

  it("callout_default_info_with_text", () => {
    expect(renderToStaticMarkup(<Callout>Your handle changes in a minute.</Callout>)).toBe(
      `<div class="${styles.root} ${styles.info}" role="note">` +
        `<span class="${styles.glyph}" aria-hidden="true">i</span>` +
        `<div class="${styles.body}"><div class="${styles.text}">Your handle changes in a minute.</div></div></div>`,
    );
  });
});
