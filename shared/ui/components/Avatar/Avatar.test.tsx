// Avatar (P1.24s): the sheet's Avatar (components/Avatar/README.md, v36 and v45, index.d.ts) as built. Differences
// from the sheet's d.ts: `name` is required (the fallback needs it); `src` is a `SafeHref`; a named fallback is a
// visually hidden name instead of role="img" with aria-label (the kit's Icon rule).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import styles from "./Avatar.module.css";
import { Avatar, avatarLetter } from "./Avatar.tsx";

const picture = safeHref("/media/avatar/a.webp", ["path"]) as SafeHref;

describe("Avatar", () => {
  it("avatar_picture_is_lazy_and_decorative", () => {
    expect(renderToStaticMarkup(<Avatar src={picture} name="Alex" size={64} />)).toBe(
      `<span class="${styles.root} ${styles.size64}"><img class="${styles.image}" src="/media/avatar/a.webp" alt=""` +
        ' width="64" height="64" loading="lazy" decoding="async"/></span>',
    );
  });

  it("avatar_fallback_letter", () => {
    expect(renderToStaticMarkup(<Avatar name="@alex.example" />)).toBe(
      `<span class="${styles.root} ${styles.size40}" aria-hidden="true">A</span>`,
    );
    expect(avatarLetter("ölga")).toBe("Ö");
    expect(avatarLetter("  ")).toBe("?");
  });

  it("avatar_named_when_alone", () => {
    const html = renderToStaticMarkup(<Avatar name="alex" alt="Alex" size={24} />);
    expect(html).toMatch(/<span aria-hidden="true">A<\/span><span class="visually-hidden">Alex<\/span>/);
    expect(html).not.toMatch(/role=/);
  });
});
