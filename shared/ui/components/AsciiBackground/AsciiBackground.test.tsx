// AsciiBackground (P1.24a): the sheet's AsciiBackground (components/AsciiBackground/README.md, index.d.ts) as built.
// Differences from the sheet's d.ts: no `height` (it would need an inline style, which the CSP refuses; size it with
// `className`), and `seed` may be text, hashed to an integer first (book P1.24a).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./AsciiBackground.module.css";
import { AsciiBackground } from "./AsciiBackground.tsx";

const RAMP = " .:-=+*#%@";
/** The characters of each row, tags removed. */
const rowsOf = (html: string) =>
  [...html.matchAll(/<div>(.*?)<\/div>/g)].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, ""));

describe("AsciiBackground", () => {
  it("ascii_background_deterministic", () => {
    const one = renderToStaticMarkup(<AsciiBackground seed={7} />);
    expect(renderToStaticMarkup(<AsciiBackground seed={7} />)).toBe(one);
    expect(renderToStaticMarkup(<AsciiBackground seed={8} />)).not.toBe(one);
    expect(one).toMatch(
      new RegExp(`^<div class="${styles.root}"><pre class="${styles.field}" aria-hidden="true"><div>`),
    );
    const rows = rowsOf(one);
    expect(rows).toHaveLength(32);
    for (const row of rows) expect([...row].every((c) => RAMP.includes(c)) && row.length === 160).toBe(true);
    expect(one).not.toMatch(/<script|style=|\son[a-z]+=/);
  });

  it("ascii_background_text_seed_hashed", () => {
    const html = renderToStaticMarkup(<AsciiBackground seed="alex.example" cols={20} rows={4} />);
    expect(rowsOf(html)).toHaveLength(4);
    expect(html).not.toContain("alex.example");
    expect(renderToStaticMarkup(<AsciiBackground seed="alex.example" cols={20} rows={4} />)).toBe(html);
  });

  it("ascii_background_bands_fade_and_children", () => {
    const grey = renderToStaticMarkup(<AsciiBackground accents={false} density={1} cols={40} rows={6} />);
    expect(grey).not.toMatch(new RegExp(`${styles.plum}|${styles.cyan}|${styles.emerald}`));
    const faded = rowsOf(renderToStaticMarkup(<AsciiBackground fadeFrom="left" cols={40} rows={6} />));
    for (const row of faded) expect(row[0]).toBe(" ");
    expect(
      renderToStaticMarkup(
        <AsciiBackground rows={1} cols={1}>
          hello
        </AsciiBackground>,
      ),
    ).toContain(`</pre><div class="${styles.content}">hello</div></div>`);
  });
});
