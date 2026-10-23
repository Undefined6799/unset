// Markdown renders the parsed subset (markdown.ts) as plain elements: React escapes every text node, member links carry
// rel="nofollow ugc noopener noreferrer", and rows of columns become a grid that stacks on narrow screens (CSS).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Markdown.module.css";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("markdown_escapes_text", () => {
    const html = renderToStaticMarkup(<Markdown source={'<img src=x onerror="alert(1)"> & <script>'} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;script&gt;");
  });

  it("markdown_member_links_are_nofollow_ugc", () => {
    const html = renderToStaticMarkup(<Markdown source="[site](https://alice.dev) [post](/@alice/p/1)" />);
    expect(html).toContain('<a href="https://alice.dev/" rel="nofollow ugc noopener noreferrer">site</a>');
    expect(html).toContain('<a href="/@alice/p/1" rel="nofollow ugc">post</a>');
  });

  it("markdown_columns_and_rows", () => {
    const html = renderToStaticMarkup(<Markdown source={"## A\n:::\n## B\n---\n## C"} />);
    expect(html).toBe(
      `<div class="${styles.root}">` +
        `<div class="${styles.row}" data-columns="2"><div class="${styles.column}"><h2>A</h2></div>` +
        `<div class="${styles.column}"><h2>B</h2></div></div>` +
        `<hr class="${styles.rule}"/>` +
        `<div class="${styles.row}" data-columns="1"><div class="${styles.column}"><h2>C</h2></div></div></div>`,
    );
  });

  it("markdown_blocks", () => {
    const html = renderToStaticMarkup(
      <Markdown source={"a\nb\n\n- x\n\n1. y\n\n> q\n\n```\nnpx **t**\n```\n\n**s** *e* `c`"} />,
    );
    expect(html).toContain("<p>a<br/>b</p>");
    expect(html).toContain("<ul><li>x</li></ul>");
    expect(html).toContain("<ol><li>y</li></ol>");
    expect(html).toContain("<blockquote><p>q</p></blockquote>");
    expect(html).toContain(`<pre class="${styles.code}"><code>npx **t**</code></pre>`);
    expect(html).toContain("<strong>s</strong> <em>e</em> <code>c</code>");
  });

  it("markdown_empty_renders_nothing", () => {
    expect(renderToStaticMarkup(<Markdown source={"  \n"} />)).toBe("");
  });
});
