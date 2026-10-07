// Footer (P1.24k): the sheet's Footer (components/Footer/README.md, index.d.ts) as built. Differences from the sheet's
// d.ts: links take a SafeHref; `note` is required (the server's year, so renders stay deterministic); external links
// end in the `external` Icon and never open a new tab (the kit's Link rule, sheet v34); `children` is the route-group
// slot P1.25 fills.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Mark } from "../Mark/Mark.tsx";
import styles from "./Footer.module.css";
import { Footer } from "./Footer.tsx";

const href = (raw: string) => safeHref(raw, ["https:", "path"]) as SafeHref;

describe("Footer", () => {
  it("footer_columns_slot_and_note", () => {
    const html = renderToStaticMarkup(
      <Footer
        columns={[
          {
            title: "Project",
            links: [
              { label: "About", href: href("/about") },
              { label: "Source", href: href("https://github.com/"), external: true },
            ],
          },
        ]}
        note="© 2026 unset.sh"
        meta="v0.1.0"
      >
        <form />
      </Footer>,
    );
    expect(html).toBe(
      `<footer class="${styles.root}"><div class="${styles.top}"><div class="${styles.brand}">` +
        `${renderToStaticMarkup(<Mark width={72} />)}<div class="${styles.code}">U+25C9</div></div>` +
        `<div class="${styles.columns}"><nav class="${styles.column}" aria-label="Project">` +
        `<div class="${styles.title}">Project</div><a class="${styles.link}" href="/about">About</a>` +
        `<a class="${styles.link}" href="https://github.com/" rel="noopener noreferrer">Source` +
        `${renderToStaticMarkup(<Icon name="external" size={16} />)}</a></nav></div></div>` +
        `<div class="${styles.slot}"><form></form></div>` +
        `<div class="${styles.bottom}"><span>© 2026 unset.sh</span><span>v0.1.0</span></div></footer>`,
    );
    expect(html).not.toMatch(/target=|↗/);
  });
});
