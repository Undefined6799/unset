// Link (P1.24; sheet components/Link/README.md, v45): `inline` inside running text, `standalone` on its own line
// ending in the 16px `next` icon, or `external` when it leaves our origin (sheet v34), never a typed arrow. Every
// link takes a `SafeHref`. A link that is not a path on our origin gets rel="noopener noreferrer"; the kit never
// opens a new tab.
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Icon } from "../Icon/Icon.tsx";
import styles from "./Link.module.css";

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "target" | "rel"> & {
  href: SafeHref;
  variant?: "inline" | "standalone";
  children: ReactNode;
  className?: string;
};

export function Link({ href, variant = "inline", children, className, ...anchor }: LinkProps) {
  // safeHref returns either a path starting with one "/" or an absolute URL, so the first character decides.
  const external = !href.startsWith("/");
  return (
    <a
      {...anchor}
      href={href}
      rel={external ? "noopener noreferrer" : undefined}
      className={classNames(variant === "standalone" ? styles.standalone : styles.inline, className)}
    >
      {children}
      {variant === "standalone" ? <Icon name={external ? "external" : "next"} size={16} /> : null}
    </a>
  );
}
