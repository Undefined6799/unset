// The kit showcase (P1.24): it shows every built component and stays zero-JS, and no control in it is named by an
// icon alone (book P1.24 `icon_has_text_label`). axe and the 24px target size run on it in P1.26's harness.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../components/Button/Button.tsx";
import { Icon } from "../components/Icon/Icon.tsx";
import { Link } from "../components/Link/Link.tsx";
import { type SafeHref, safeHref } from "../safe-href.ts";
import { SAMPLES, Showcase } from "./Showcase.tsx";

const inventory = JSON.parse(readFileSync(join(import.meta.dirname, "..", "inventory.json"), "utf8")) as Record<
  string,
  { status: string }
>;

/** Links and buttons whose only content is an icon: what is left after the drawings are removed is their name. */
function unlabelledControls(html: string): string[] {
  const controls = html.match(/<(a|button)\b[^>]*>[\s\S]*?<\/\1>/g) ?? [];
  return controls.filter((control) => {
    const text = control.replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
    return text.trim() === "";
  });
}

describe("Showcase", () => {
  it("showcase_covers_built_components", () => {
    const built = Object.keys(inventory).filter((name) => inventory[name]?.status === "built");
    expect(Object.keys(SAMPLES).sort()).toEqual(built.sort());
  });

  it("showcase_is_zero_js", () => {
    const html = renderToStaticMarkup(<Showcase />);
    expect(html).not.toMatch(/<script|<img|\son[a-z]+=|style=/i);
  });

  it("icon_has_text_label", () => {
    expect(unlabelledControls(renderToStaticMarkup(<Showcase />))).toEqual([]);
    const href = safeHref("/x", ["path"]) as SafeHref;
    const iconOnly = renderToStaticMarkup(
      <>
        <Button>
          <Icon name="close" />
        </Button>
        <Link href={href}>
          <Icon name="more" />
        </Link>
      </>,
    );
    expect(unlabelledControls(iconOnly)).toHaveLength(2);
    const labelled = renderToStaticMarkup(
      <Button>
        <Icon name="close" label="Close" />
      </Button>,
    );
    expect(unlabelledControls(labelled)).toEqual([]);
  });
});
