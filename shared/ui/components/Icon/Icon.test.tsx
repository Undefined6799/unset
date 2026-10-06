// Icon (P1.24i): the sheet's Icon (components/Icon/README.md, index.d.ts) as built. Differences from the sheet's
// draft: the classes are the kit's (`visually-hidden`, no `us-` prefix); nothing else.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import data from "../../icons/icons.json" with { type: "json" };
import { Icon } from "./Icon.tsx";

describe("Icon", () => {
  it("icon_renders_inline", () => {
    const html = renderToStaticMarkup(<Icon name="next" />);
    expect(html).toBe(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-width="1.5" aria-hidden="true" focusable="false">' +
        '<path d="M3 12L21 12M21 12L12.5 3.5M21 12L12.5 20.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>' +
        "</svg>",
    );
    expect(html).not.toMatch(/<img|role="img"|aria-label|style=|<script/);
  });

  it("icon_renders_every_name_from_its_drawing", () => {
    for (const [name, elements] of Object.entries(data.drawings)) {
      const html = renderToStaticMarkup(<Icon name={name as keyof typeof data.drawings} />);
      expect(html.match(/<path /g)?.length, name).toBe(elements.length);
      expect(html, name).not.toMatch(/stroke="(?!currentColor)/);
    }
  });

  it("icon_sizes_follow_the_sheet", () => {
    expect(renderToStaticMarkup(<Icon name="close" size={16} />)).toMatch(/^<svg width="16" height="16"/);
    expect(renderToStaticMarkup(<Icon name="close" size={24} />)).toMatch(/^<svg width="24" height="24"/);
  });

  it("icon_label_is_visually_hidden_text", () => {
    const html = renderToStaticMarkup(<Icon name="like" label="Like" className="x" />);
    expect(html).toMatch(/^<svg class="x" width="20"/);
    expect(html).toMatch(/aria-hidden="true"/);
    expect(html.endsWith('</svg><span class="visually-hidden">Like</span>')).toBe(true);
  });
});
