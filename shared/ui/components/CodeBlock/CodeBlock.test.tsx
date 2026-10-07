// CodeBlock (P1.24a): the sheet's CodeBlock (components/CodeBlock/README.md, index.d.ts) as built. Difference from the
// sheet: no copy control yet; it is the copy island (P1.24j), so without JS the bar holds only the file name.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./CodeBlock.module.css";
import { CodeBlock } from "./CodeBlock.tsx";

const CODE = '# unset config\n[profile]\nhandle = "alex.example"\npublic = true\nretries = 3\n';
const shell = (bar: string, code: string) =>
  `<div class="${styles.root}"><div class="${styles.bar}">${bar}</div>` +
  `<pre class="${styles.pre}" tabindex="0"><code>${code}</code></pre></div>`;

describe("CodeBlock", () => {
  it("codeblock_sheet_colours", () => {
    expect(renderToStaticMarkup(<CodeBlock code={CODE} filename="~/.unset/config.toml" />)).toBe(
      shell(
        "~/.unset/config.toml",
        `<span class="${styles.comment}"># unset config</span>\n` +
          `<span class="${styles.section}">[profile]</span>\n` +
          `handle = <span class="${styles.string}">&quot;alex.example&quot;</span>\n` +
          `public = <span class="${styles.number}">true</span>\n` +
          `retries = <span class="${styles.number}">3</span>`,
      ),
    );
  });

  it("codeblock_plain_and_escaped", () => {
    expect(renderToStaticMarkup(<CodeBlock code={'<b>"1"</b>'} language="plain" />)).toBe(
      shell("plain", "&lt;b&gt;&quot;1&quot;&lt;/b&gt;"),
    );
    expect(renderToStaticMarkup(<CodeBlock code="" />)).not.toMatch(/<button|<script/);
  });
});
