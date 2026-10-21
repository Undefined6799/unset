// Search (P1.24u): the sheet's Search (components/Search/README.md, index.d.ts) as built, no-JS form. Differences from
// the sheet's d.ts: `action` and `webAction` (same-origin paths the form GETs with `q`) replace `onSearch` and
// `onSearchWeb`; the results list (`groups`, `onPick`) waits for P3.14s's route. The keys are the search island's
// (SearchKeys.test.tsx).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import styles from "./Search.module.css";
import { Search } from "./Search.tsx";

const people = safeHref("/people", ["path"]) as SafeHref;
const web = safeHref("/search", ["path"]) as SafeHref;

describe("Search", () => {
  it("search_form_gets_q", () => {
    const html = renderToStaticMarkup(<Search action={people} webAction={web} />);
    expect(html).toMatch(/^<search><form [^>]*>/);
    expect(html).toMatch(/<\/form><\/search>$/);
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/people"');
    const input = /<input [^>]*>/.exec(html)?.[0] ?? "";
    for (const attribute of [
      'type="search"',
      'name="q"',
      'minLength="2"',
      'maxLength="64"',
      'autoComplete="off"',
      "required",
    ])
      expect(input).toContain(attribute);
    expect(input).toContain('placeholder="search people, posts and the web"');
  });

  it("search_named_by_a_label", () => {
    const html = renderToStaticMarkup(<Search action={people} webAction={web} label="Find" />);
    const id = /<input [^>]*id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`<label class="visually-hidden" for="${id}">Find</label>`);
  });

  it("search_shows_slash_hint_unless_shortcut_off", () => {
    expect(renderToStaticMarkup(<Search action={people} webAction={web} />)).toContain(`${styles.hint}`);
    expect(renderToStaticMarkup(<Search action={people} webAction={web} shortcut={false} />)).not.toContain(
      `${styles.hint}`,
    );
  });

  it("search_keeps_the_query", () => {
    const html = renderToStaticMarkup(<Search action={people} webAction={web} defaultValue={'a "b" <c>'} />);
    expect(html).toContain('value="a &quot;b&quot; &lt;c&gt;"');
  });

  it("search_default_button_is_the_unset_search", () => {
    // Implicit submission clicks the form's first submit button (HTML, "implicit submission"), hidden or not, so the
    // first one must carry no formaction or a plain Enter would go to the web.
    const html = renderToStaticMarkup(<Search action={people} webAction={web} />);
    const first = /<button [^>]*type="submit"[^>]*>/.exec(html)?.[0] ?? "";
    expect(first).not.toBe("");
    expect(first).not.toContain("formAction");
  });

  it("search_action_must_be_a_path", () => {
    const external = safeHref("https://evil.example/search", ["https:"]) as SafeHref;
    expect(external).not.toBeNull();
    expect(() => renderToStaticMarkup(<Search action={external} webAction={web} />)).toThrow();
    expect(() => renderToStaticMarkup(<Search action={people} webAction={external} />)).toThrow();
  });

  it("search_web_submit_targets_web_action", () => {
    const html = renderToStaticMarkup(<Search action={people} webAction={web} />);
    const button = /<button [^>]*formAction[^>]*>/.exec(html)?.[0] ?? "";
    for (const attribute of ['type="submit"', 'formAction="/search"', "hidden", 'tabindex="-1"'])
      expect(button).toContain(attribute);
  });
});
