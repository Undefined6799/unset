// CommandBlock (P1.24f, P1.24j): the sheet's CommandBlock (components/CommandBlock/README.md, index.d.ts) as built.
// The copy control is the copy island (CopyButton.test.tsx), placed by IslandSlot; with no provider, as here, the slot
// prints only its empty live region, so the server never prints a button. The copy and denied cases run in P1.26's
// browser harness.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./CommandBlock.module.css";
import { CommandBlock } from "./CommandBlock.tsx";

const LIVE = '<span class="visually-hidden" aria-live="polite"></span>';
const codeIds = (html: string) => [...html.matchAll(/<code id="([^"]+)">/g)].map((match) => match[1] ?? "");

describe("CommandBlock", () => {
  it("commandblock_no_js_no_button", () => {
    const html = renderToStaticMarkup(
      <CommandBlock command="unset login alex.example" output={["# checking", "[ok] signed in", "done"]} />,
    );
    const [id] = codeIds(html);
    expect(html).toBe(
      `<div><div class="${styles.line}"><pre class="${styles.command}" tabindex="0"><code id="${id}">` +
        `<span class="${styles.prompt}" aria-hidden="true">$ </span>unset login alex.example</code></pre>${LIVE}</div>` +
        `<pre class="${styles.output}"><div class="${styles.comment}"># checking</div>` +
        `<div>${renderToStaticMarkup(<Tag status="ok" />)} signed in</div><div>done</div></pre></div>`,
    );
    expect(html).not.toMatch(/<button|<script/);
  });

  it("commandblock_not_copyable", () => {
    const html = renderToStaticMarkup(<CommandBlock command="ls" copyable={false} />);
    expect(html).not.toContain("aria-live");
  });

  it("island_slot_ids_not_from_data", () => {
    // Two blocks with one command get two ids from React's useId; the command never shapes an id.
    const html = renderToStaticMarkup(
      <>
        <CommandBlock command="npm ci" />
        <CommandBlock command="npm ci" />
      </>,
    );
    const ids = codeIds(html);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // React 19.3.0 useId: `_R_<n>_` on the server.
    for (const id of ids) expect(id).toMatch(/^_R_[0-9a-z]+_$/);
  });

  it("commandblock_prompt_and_escaping", () => {
    const html = renderToStaticMarkup(<CommandBlock command={'echo "<b>"'} prompt={null} />);
    expect(html).toBe(
      `<div><div class="${styles.line}"><pre class="${styles.command}" tabindex="0"><code id="${codeIds(html)[0]}">` +
        `echo &quot;&lt;b&gt;&quot;</code></pre>${LIVE}</div></div>`,
    );
    expect(renderToStaticMarkup(<CommandBlock command="ls" prompt="#" />)).toContain("># </span>ls");
  });
});
