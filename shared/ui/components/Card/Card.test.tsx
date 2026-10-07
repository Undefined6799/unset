// Card (P1.24a): the sheet's Card (components/Card/README.md, index.d.ts) as built. Difference from the sheet's d.ts:
// `action.href` is a SafeHref, as every kit link takes. The action is the standalone Link, which ends in `next`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Link } from "../Link/Link.tsx";
import styles from "./Card.module.css";
import { Card } from "./Card.tsx";

const href = safeHref("/docs", ["path"]) as SafeHref;

describe("Card", () => {
  it("card_renders_sheet_parts", () => {
    const link = renderToStaticMarkup(
      <Link href={href} variant="standalone">
        Read more
      </Link>,
    );
    expect(
      renderToStaticMarkup(
        <Card eyebrow="01" title="Own your handle" action={{ label: "Read more", href }}>
          Use your domain.
        </Card>,
      ),
    ).toBe(
      `<div class="${styles.root}"><div class="${styles.eyebrow}">01</div>` +
        `<h3 class="${styles.title}">Own your handle</h3><div class="${styles.body}">Use your domain.</div>` +
        `<div class="${styles.action}">${link}</div></div>`,
    );
    expect(link).toContain("<svg");
    expect(renderToStaticMarkup(<Card title="Plain" />)).toBe(
      `<div class="${styles.root}"><h3 class="${styles.title}">Plain</h3></div>`,
    );
  });

  it("card_no_solid_variant", () => {
    // @ts-expect-error: there is no `solid` prop; every card is solid.
    expect(renderToStaticMarkup(<Card solid title="x" />)).not.toContain("solid");
  });

  it("card_surface_opaque", () => {
    const css = readFileSync(join(import.meta.dirname, "Card.module.css"), "utf8");
    expect(css).toContain("background-color: var(--color-surface-card);");
    expect(css).not.toMatch(/surface-card-solid|opacity|color-mix|backdrop/);
  });
});
