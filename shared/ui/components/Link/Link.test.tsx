// Link (P1.24): the sheet's Link (components/Link/README.md, index.d.ts) as built. Differences from the sheet's d.ts:
// `href` is a `SafeHref`; `target` and `rel` are not props (the kit sets rel and never opens a new tab); a standalone
// link ends in the `next` or `external` Icon instead of a typed "→".
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import styles from "./Link.module.css";
import { Link } from "./Link.tsx";

const href = (raw: string) => safeHref(raw, ["https:", "mailto:", "path"]) as SafeHref;

describe("Link", () => {
  it("link_inline_is_plain_text_link", () => {
    expect(renderToStaticMarkup(<Link href={href("/about")}>about</Link>)).toBe(
      `<a href="/about" class="${styles.inline}">about</a>`,
    );
  });

  it("link_external_rel", () => {
    const html = renderToStaticMarkup(<Link href={href("https://atproto.com/specs")}>specs</Link>);
    expect(html).toBe(
      `<a href="https://atproto.com/specs" rel="noopener noreferrer" class="${styles.inline}">specs</a>`,
    );
    expect(html).not.toMatch(/target=/);
    expect(renderToStaticMarkup(<Link href={href("mailto:a@b.example")}>mail</Link>)).toMatch(
      /rel="noopener noreferrer"/,
    );
  });

  it("next_icon_on_standalone_link", () => {
    const html = renderToStaticMarkup(
      <Link href={href("/docs")} variant="standalone">
        Read the docs
      </Link>,
    );
    expect(html).toMatch(new RegExp(`^<a href="/docs" class="${styles.standalone}">Read the docs<svg width="16"`));
    expect(html).toContain('<path d="M3 12L21 12M21 12L12.5 3.5M21 12L12.5 20.5"'); // the next icon
    expect(html).not.toContain("→");
  });

  it("standalone_external_link_ends_in_external_icon", () => {
    const external = renderToStaticMarkup(
      <Link href={href("https://atproto.com/")} variant="standalone">
        AT Protocol
      </Link>,
    );
    const next = renderToStaticMarkup(
      <Link href={href("/x")} variant="standalone">
        x
      </Link>,
    );
    expect(external).toMatch(/rel="noopener noreferrer"/);
    expect(external.replace(/^.*?<svg/, "<svg")).not.toBe(next.replace(/^.*?<svg/, "<svg"));
  });
});
