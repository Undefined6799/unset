// Icon (P1.24i; plan §7, decision 33): one of the sheet's 36 Iconoir 7.12.1 icons, drawn inline on the server from
// icons/icons.json (zero JS, no <img>, no CSP change). The drawing is always aria-hidden; meaning comes from a word
// beside it or from `label`, a visually hidden span (never role="img"). Sized by the sheet's three sizes.
import type { SVGProps } from "react";
import data from "../../icons/icons.json" with { type: "json" };

export type IconName = keyof typeof data.drawings;

export type IconProps = {
  name: IconName;
  /** 20 (default), 16 inside small text, or 24 on its own in a bar. */
  size?: 16 | 20 | 24;
  /** Hidden text read by screen readers; leave out only when a visible word beside it says the same. */
  label?: string;
  className?: string;
};

type PathAttributes = Pick<
  SVGProps<SVGPathElement>,
  "d" | "fill" | "stroke" | "strokeWidth" | "strokeLinecap" | "strokeLinejoin"
>;
// The icon build admits only these attributes, with Iconoir's own values (scripts/icons.ts, checked against the sheet).
const drawings = data.drawings as Readonly<Record<IconName, readonly PathAttributes[]>>;

export function Icon({ name, size = 20, label, className }: IconProps) {
  return (
    <>
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="1.5"
        aria-hidden="true"
        focusable="false"
      >
        {drawings[name].map((attributes, index) => (
          // The list is fixed per icon and never reordered, so its position is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: static drawing
          <path key={index} {...attributes} />
        ))}
      </svg>
      {label === undefined ? null : <span className="visually-hidden">{label}</span>}
    </>
  );
}
