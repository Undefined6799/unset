// Header (P1.24k): the sheet's Header (components/Header/README.md, index.d.ts) as built. Differences from the sheet's
// d.ts: links take a SafeHref; the action is a link only (no onClick, no JS); the folded menu is a <details> beside
// the inline nav rather than a JS toggle (book P1.24a, split record 2026-10-07-p124a-split.md); `menuLabel` added.
// `header_folds_by_container` and the island's Escape run in P1.26's browser harness.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Button } from "../Button/Button.tsx";
import { Mark } from "../Mark/Mark.tsx";
import styles from "./Header.module.css";
import { Header } from "./Header.tsx";

const href = (raw: string) => safeHref(raw, ["path"]) as SafeHref;

describe("Header", () => {
  it("header_menu_details_no_js", () => {
    const html = renderToStaticMarkup(
      <Header
        nav={[
          { label: "Home", href: href("/"), current: true },
          { label: "Explore", href: href("/explore") },
        ]}
        action={{ label: "Sign in", href: href("/signin") }}
      />,
    );
    const nav =
      `<nav class="${styles.nav}" aria-label="Main">` +
      `<a href="/" class="${styles.item} ${styles.current}" aria-current="page">Home</a>` +
      `<a href="/explore" class="${styles.item}">Explore</a>` +
      `${renderToStaticMarkup(
        <Button as="a" href={href("/signin")}>
          Sign in
        </Button>,
      )}</nav>`;
    expect(html).toBe(
      `<header class="${styles.root}"><div class="${styles.bar}"><a class="${styles.home}" href="/">` +
        `${renderToStaticMarkup(<Mark width={72} title="unset.sh home" />)}</a>` +
        `<div class="${styles.wide}">${nav}</div>` +
        `<details class="${styles.menu}"><summary class="${styles.toggle}">menu` +
        `<span class="${styles.caret}" aria-hidden="true"></span></summary>` +
        `<div class="${styles.panel}">${nav}</div></details></div></header>`,
    );
    expect(html).not.toMatch(/<script|\son[a-z]+=/);
  });

  it("header_folds_by_container_css", () => {
    const css = readFileSync(join(import.meta.dirname, "Header.module.css"), "utf8");
    expect(css).toContain("container-type: inline-size;");
    expect(css).toMatch(
      /@container \(max-width: 440px\) \{\s+\.wide \{\s+display: none;\s+\}\s+\.menu \{\s+display: block;/,
    );
    expect(css).not.toContain("@media (max-width");
  });
});
