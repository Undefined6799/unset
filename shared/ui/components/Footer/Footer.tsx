// Footer (P1.24k; sheet components/Footer/README.md, v45): the mark with "U+25C9" beneath it, link columns, and a small
// mono line at the bottom, over a `line` rule. External links end in the 16px `external` Icon (sheet v34), never a
// typed ↗, and the kit never opens a new tab. `children` is the one slot P1.25 fills by route group (PrefsForms on
// app pages, LanguageLinks on public pages). Feed pages have no footer.
import type { ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Mark } from "../Mark/Mark.tsx";
import styles from "./Footer.module.css";

export type FooterProps = {
  /** Two or three columns of at most five links. */
  columns: readonly { title: string; links: readonly { label: string; href: SafeHref; external?: boolean }[] }[];
  /** The bottom line, e.g. "© 2026 unset.sh". */
  note: ReactNode;
  /** Right-aligned on the bottom line. */
  meta?: ReactNode;
  /** The route group's slot. */
  children?: ReactNode;
  className?: string;
};

export function Footer({ columns, note, meta, children, className }: FooterProps) {
  return (
    <footer className={classNames(styles.root, className)}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <Mark width={72} />
          <div className={styles.code}>U+25C9</div>
        </div>
        <div className={styles.columns}>
          {columns.map((column) => (
            <nav key={column.title} className={styles.column} aria-label={column.title}>
              <div className={styles.title}>{column.title}</div>
              {column.links.map((link) => (
                <a
                  key={link.href}
                  className={styles.link}
                  href={link.href}
                  rel={link.external === true ? "noopener noreferrer" : undefined}
                >
                  {link.label}
                  {link.external === true ? <Icon name="external" size={16} /> : null}
                </a>
              ))}
            </nav>
          ))}
        </div>
      </div>
      {children === undefined ? null : <div className={styles.slot}>{children}</div>}
      <div className={styles.bottom}>
        <span>{note}</span>
        {meta === undefined ? null : <span>{meta}</span>}
      </div>
    </footer>
  );
}
