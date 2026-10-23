// Readme renders the lexicon's README blocks (P2.20w) as plain elements: React escapes every text node, a link is kept
// only when safeHref accepts it as http(s), lists nest by indent, and columns become a grid (CSS).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Readme.module.css";
import { Readme, type ReadmeProps } from "./Readme.tsx";

const D = "sh.unset.profile#";
const LABELS = { done: "Done", notDone: "Not done" };
const t = (text: string, styles: Record<string, boolean> = {}) => ({ $type: `${D}textRun` as const, text, ...styles });
const p = (...content: ReturnType<typeof t>[]) => ({ $type: `${D}paragraph` as const, content });
const li = (style: string, text: string, indent = 0, checked = false) => ({
  $type: `${D}listItem` as const,
  style,
  indent,
  checked,
  content: [t(text)],
});
const html = (blocks: ReadmeProps["blocks"]) => renderToStaticMarkup(<Readme blocks={blocks} labels={LABELS} />);

describe("Readme", () => {
  it("readme_escapes_text", () => {
    const out = html([p(t('<img src=x onerror="alert(1)"> & <script>'))]);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;script&gt;");
  });

  it("readme_links_only_http_and_say_user_content", () => {
    const link = (uri: string) => ({ $type: `${D}linkRun` as const, uri, content: [t("site")] });
    const out = html([
      { $type: `${D}paragraph`, content: [link("https://alice.dev"), link("javascript:alert(1)"), link("/settings")] },
    ]);
    expect(out).toContain(
      '<p><a href="https://alice.dev/" rel="nofollow ugc noopener noreferrer">site</a>sitesite</p>',
    );
  });

  it("readme_text_styles", () => {
    const out = html([p(t("b", { bold: true }), t("i", { italic: true }), t("c", { code: true, strike: true }))]);
    expect(out).toContain("<p><strong>b</strong><em>i</em><s><code>c</code></s></p>");
  });

  it("readme_headings_sit_under_the_page_title", () => {
    const h = (level: number) => ({ $type: `${D}heading` as const, level, content: [t(`h${level}`)] });
    expect(html([h(1), h(2), h(3)])).toContain("<h2>h1</h2><h3>h2</h3><h4>h3</h4>");
  });

  it("readme_lists_group_and_nest_by_indent", () => {
    const out = html([li("bullet", "a"), li("bullet", "a1", 1), li("bullet", "b"), li("numbered", "1"), p(t("x"))]);
    expect(out).toContain("<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul><ol><li>1</li></ol><p>x</p>");
  });

  it("readme_check_items_say_their_state", () => {
    const out = html([li("check", "ship", 0, true), li("check", "rest")]);
    expect(out).toContain('<span class="visually-hidden">Done</span>ship');
    expect(out).toContain('[ ]</span><span class="visually-hidden">Not done</span>rest');
  });

  it("readme_columns_and_code", () => {
    const out = html([
      {
        $type: `${D}columns`,
        columns: [{ blocks: [p(t("a"))] }, { blocks: [{ $type: `${D}codeBlock`, text: "npm **t**" }] }],
      },
    ]);
    expect(out).toBe(
      `<div class="${styles.root}"><div class="${styles.columns}" data-columns="2"><div><p>a</p></div>` +
        `<div><pre class="${styles.code}"><code>npm **t**</code></pre></div></div></div>`,
    );
  });

  it("readme_empty_renders_nothing", () => {
    expect(html([])).toBe("");
  });
});
