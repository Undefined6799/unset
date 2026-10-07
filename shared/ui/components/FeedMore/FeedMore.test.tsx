// FeedMore (P1.24f): the sheet's FeedMore (components/FeedMore/README.md, index.d.ts) as built. Differences from the
// sheet's d.ts: `older` is a SafeHref, required for idle and error and absent for loading and end; no `onRetry` (the
// feed island, P4.21, drives the states and the in-place load).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Spinner } from "../Spinner/Spinner.tsx";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./FeedMore.module.css";
import { FeedMore } from "./FeedMore.tsx";

const older = safeHref("/?cursor=abc", ["path"]) as SafeHref;
const wrap = (body: string) => `<div class="${styles.root}" aria-live="polite">${body}</div>`;

describe("FeedMore", () => {
  it("feedmore_nojs_link", () => {
    expect(renderToStaticMarkup(<FeedMore older={older} />)).toBe(
      wrap(
        `<a class="${styles.link}" href="/?cursor=abc">older posts${renderToStaticMarkup(<Icon name="down" size={16} />)}</a>`,
      ),
    );
  });

  it("feedmore_states", () => {
    expect(renderToStaticMarkup(<FeedMore state="loading" />)).toBe(
      wrap(renderToStaticMarkup(<Spinner label="loading older posts" />)),
    );
    expect(renderToStaticMarkup(<FeedMore state="end" />)).toBe(
      wrap(`<span>${renderToStaticMarkup(<Tag>end</Tag>)} you&#x27;re all caught up</span>`),
    );
    expect(renderToStaticMarkup(<FeedMore state="error" older={older} />)).toBe(
      wrap(
        `<span>${renderToStaticMarkup(<Tag status="err" />)} couldn&#x27;t load more ` +
          `<a class="${styles.link}" href="/?cursor=abc">try again</a></span>`,
      ),
    );
    // @ts-expect-error: the end has no next page to link.
    expect(renderToStaticMarkup(<FeedMore state="end" older={older} />)).not.toContain("<a");
  });
});
