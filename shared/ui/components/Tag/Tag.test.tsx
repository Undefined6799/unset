// Tag (P1.24): the sheet's Tag (components/Tag/README.md, index.d.ts) as built; no differences. Quiet brackets
// (Alex 2026-10-21): the word takes the status colour and is uppercased by the style, the brackets stay `ink-muted`.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Tag.module.css";
import { Tag } from "./Tag.tsx";

describe("Tag", () => {
  it("tag_prints_brackets_and_status_word", () => {
    const tag = (status: string, word: string) =>
      `<span class="${styles.root} ${styles[status]}"><span class="${styles.bracket}">[ </span>` +
      `<span class="${styles.word}">${word}</span><span class="${styles.bracket}"> ]</span></span>`;
    expect(renderToStaticMarkup(<Tag status="err" />)).toBe(tag("err", "err"));
    expect(renderToStaticMarkup(<Tag />)).toBe(tag("plain", "plain"));
    expect(renderToStaticMarkup(<Tag status="ok">live</Tag>)).toBe(tag("ok", "live"));
  });

  it("tag_brackets_quiet_word_uppercase", () => {
    const css = readFileSync(new URL("./Tag.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.bracket\s*\{\s*color:\s*var\(--color-ink-muted\)/);
    expect(css).toMatch(/\.word\s*\{\s*text-transform:\s*uppercase/);
  });
});
