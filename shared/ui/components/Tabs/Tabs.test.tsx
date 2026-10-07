// Tabs (P1.24k): the sheet's Tabs (components/Tabs/README.md, index.d.ts) as built, no-JS form. Differences from the
// sheet's d.ts: `selected` (from the query) and `hrefFor` replace `defaultId`/`value`/`onChange`, since each tab is a
// link the server answers; `label` names the set. The tabs island (P1.24j) adds the ARIA tabs pattern and keys.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import styles from "./Tabs.module.css";
import { Tabs } from "./Tabs.tsx";

const tabs = [
  { id: "a", label: "curl", content: "panel a" },
  { id: "b", label: "npm", content: "panel b" },
];
const hrefFor = (id: string) => safeHref(`/install?tab=${encodeURIComponent(id)}`, ["path"]) as SafeHref;
const render = (selected?: string) =>
  renderToStaticMarkup(<Tabs tabs={tabs} selected={selected} hrefFor={hrefFor} label="Install method" />);
const markup = (current: "a" | "b") =>
  `<div><nav aria-label="Install method"><ul class="${styles.list}">` +
  tabs
    .map((tab) =>
      tab.id === current
        ? `<li><a class="${styles.tab} ${styles.current}" href="/install?tab=${tab.id}" aria-current="page">${tab.label}</a></li>`
        : `<li><a class="${styles.tab}" href="/install?tab=${tab.id}">${tab.label}</a></li>`,
    )
    .join("") +
  `</ul></nav><div class="${styles.panel}">panel ${current}</div></div>`;

describe("Tabs", () => {
  it("tabs_link_fallback", () => {
    expect(render("b")).toBe(markup("b"));
    expect(render()).toBe(markup("a"));
  });

  it("tabs_unknown_param", () => {
    const html = render("<script>x</script>");
    expect(html).toBe(markup("a"));
    expect(html).not.toContain("script");
  });
});
