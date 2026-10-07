// NewPosts (P1.24f): the sheet's NewPosts (components/NewPosts/README.md, index.d.ts) as built. Differences from the
// sheet's d.ts: `count` and `href` (a SafeHref) are required; no `children` or `onClick` (the feed island, P4.21,
// drives it). The scroll behaviours (`newposts_hides_on_scroll_up`, `newposts_top_reloads_in_place`,
// `newposts_show_does_both`) belong to that island; motion and themes run in P1.26's harness.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./NewPosts.module.css";
import { NewPosts, newPostsText } from "./NewPosts.tsx";

const feed = safeHref("/", ["path"]) as SafeHref;

describe("NewPosts", () => {
  it("newposts_status_bar_text", () => {
    expect(renderToStaticMarkup(<NewPosts count={3} href={feed} />)).toBe(
      `<div class="${styles.root}"><span>${renderToStaticMarkup(<Tag status="info" />)} 3 new posts</span>` +
        `<a class="${styles.show}" href="/">show${renderToStaticMarkup(<Icon name="up" size={16} />)}</a></div>`,
    );
    expect([1, 2, 99, 100].map(newPostsText)).toEqual(["1 new post", "2 new posts", "99 new posts", "99+ new posts"]);
    expect(renderToStaticMarkup(<NewPosts count={1} href={feed} hidden />)).toContain(
      `class="${styles.root} ${styles.hidden}"`,
    );
  });

  it("newposts_reduced_motion", () => {
    const css = readFileSync(join(import.meta.dirname, "NewPosts.module.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s+\.root \{\s+transition: none;/);
  });
});
