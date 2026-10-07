// Icon (P1.24i; plan §7, decision 33): one of the sheet's 36 Iconoir 7.12.1 icons, drawn inline on the server from
// icons/icons.json (zero JS, no <img>, no CSP change). The drawing is always aria-hidden; meaning comes from a word
// beside it or from `label`, a visually hidden span (never role="img"). Sized by the sheet's three sizes.
// Islands draw with `IconDrawing` and one generated module from icons/drawings/, so they never bundle every drawing
// (P1.24b; architecture record 2026-10-07-p124b-island-icons.md); both render through the one `Drawing` below.
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
/** One icon's drawing: its <path> attributes, as icons/drawings/<name>.generated.ts exports them. */
export type IconPaths = readonly Readonly<PathAttributes>[];
// The icon build admits only these attributes, with Iconoir's own values (scripts/icons.ts, checked against the sheet).
const drawings = data.drawings as Readonly<Record<IconName, IconPaths>>;

export type IconDrawingProps = Omit<IconProps, "name"> & { paths: IconPaths };

export function Icon({ name, ...rest }: IconProps) {
  return <Drawing paths={drawings[name]} {...rest} />;
}

/** For islands: the same markup as `Icon`, from a drawing module the island imports by itself. */
export function IconDrawing(props: IconDrawingProps) {
  return <Drawing {...props} />;
}

function Drawing({ paths, size = 20, label, className }: IconDrawingProps) {
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
        {paths.map((attributes, index) => (
          // The list is fixed per icon and never reordered, so its position is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: static drawing
          <path key={index} {...attributes} />
        ))}
      </svg>
      {label === undefined ? null : <span className="visually-hidden">{label}</span>}
    </>
  );
}
