// CommandBlock (P1.24f): the sheet's CommandBlock (components/CommandBlock/README.md, index.d.ts) as built, no-JS form.
// Difference from the sheet's d.ts: no `copyable`; the copy control is the copy island (P1.24j), so the server never
// prints a button. The copy and denied cases run in P1.26's browser harness.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./CommandBlock.module.css";
import { CommandBlock } from "./CommandBlock.tsx";

describe("CommandBlock", () => {
  it("commandblock_no_js_no_button", () => {
    const html = renderToStaticMarkup(
      <CommandBlock command="unset login alex.example" output={["# checking", "[ok] signed in", "done"]} />,
    );
    expect(html).toBe(
      `<div><pre class="${styles.line}" tabindex="0"><code>` +
        `<span class="${styles.prompt}" aria-hidden="true">$ </span>unset login alex.example</code></pre>` +
        `<pre class="${styles.output}"><div class="${styles.comment}"># checking</div>` +
        `<div>${renderToStaticMarkup(<Tag status="ok" />)} signed in</div><div>done</div></pre></div>`,
    );
    expect(html).not.toMatch(/<button|<script/);
  });

  it("commandblock_prompt_and_escaping", () => {
    expect(renderToStaticMarkup(<CommandBlock command={'echo "<b>"'} prompt={null} />)).toBe(
      `<div><pre class="${styles.line}" tabindex="0"><code>echo &quot;&lt;b&gt;&quot;</code></pre></div>`,
    );
    expect(renderToStaticMarkup(<CommandBlock command="ls" prompt="#" />)).toContain("># </span>ls");
  });
});
