// Pagination (P1.24s): the sheet's Pagination (components/Pagination/README.md, v44 and v45, index.d.ts) as built.
// Differences from the sheet's d.ts: every href is a `SafeHref`, so `hrefFor` is required (the sheet's default
// "?page=n" is not a path); the two forms are a union, so a numbered list cannot also take cursors.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import styles from "./Pagination.module.css";
import { Pagination, pageList } from "./Pagination.tsx";

const at = (raw: string) => safeHref(raw, ["path"]) as SafeHref;
const hrefFor = (n: number) => at(`/admin/reports?page=${n}`);

describe("Pagination", () => {
  it("pagination_numbered_and_cursor", () => {
    const numbered = renderToStaticMarkup(<Pagination page={5} pages={12} hrefFor={hrefFor} />);
    expect(numbered).toMatch(/^<nav class="[^"]+" aria-label="Pages">/);
    expect(numbered).toContain(
      `<a class="${styles.item} ${styles.current}" href="/admin/reports?page=5" aria-current="page">5</a>`,
    );
    expect(numbered.match(/aria-current/g)).toHaveLength(1);
    expect(numbered).toContain(`<li class="${styles.count}">5 / 12</li>`);

    const cursor = renderToStaticMarkup(<Pagination older={at("/followers?cursor=abc")} newer={null} />);
    expect(cursor).toContain('href="/followers?cursor=abc"');
    expect(cursor).toMatch(new RegExp(`<span class="${styles.item} ${styles.off}"><svg[^]*?</svg>newer</span>`));
    expect(cursor).not.toMatch(/aria-current|\d+ \/ |page=/);
    // An end left out is the same as one passed as null: greyed, not a link.
    expect(renderToStaticMarkup(<Pagination older={at("/followers?cursor=abc")} />)).toBe(cursor);
  });

  it("pagination_shows_ends_and_neighbours", () => {
    expect(pageList(5, 12)).toEqual([1, "gap", 4, 5, 6, "gap", 12]);
    expect(pageList(1, 3)).toEqual([1, 2, 3]);
    expect(pageList(2, 4)).toEqual([1, 2, 3, 4]);
    expect(pageList(1, 1)).toEqual([1]);
  });

  it("pagination_ends_are_not_links", () => {
    const html = renderToStaticMarkup(<Pagination page={1} pages={2} hrefFor={hrefFor} />);
    expect(html).toMatch(new RegExp(`<span class="${styles.item} ${styles.off}"><svg[^]*?</svg>prev</span>`));
    expect(html).toContain('href="/admin/reports?page=2"');
  });
});
