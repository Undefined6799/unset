// Kbd (P1.24): the sheet's Kbd (components/Kbd/README.md, index.d.ts) as built; no differences.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Kbd.module.css";
import { Kbd } from "./Kbd.tsx";

describe("Kbd", () => {
  it("kbd_is_one_key", () => {
    expect(renderToStaticMarkup(<Kbd>⌘</Kbd>)).toBe(`<kbd class="${styles.root}">⌘</kbd>`);
  });
});
