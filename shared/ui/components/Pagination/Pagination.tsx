// Pagination (P1.24s; sheet components/Pagination/README.md, v45; approved by Alex 2026-10-04), for lists that are
// not feeds: numbered pages for admin lists, or `newer` / `older` cursor links for followers and search. Plain links
// in a <nav>, so every page has its own address and it works with no JS. Feeds use FeedMore (P1.24a) instead.
import type { ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Icon } from "../Icon/Icon.tsx";
import styles from "./Pagination.module.css";

export type PaginationProps = {
  /** The nav's accessible name. */
  label?: string;
  className?: string;
} & (
  | { page: number; pages: number; hrefFor: (page: number) => SafeHref }
  | { newer?: SafeHref | null | undefined; older?: SafeHref | null | undefined }
);

/** The pages to show: the first, the last and one on each side of the current one, with "gap" where pages are left out. */
export function pageList(page: number, pages: number): (number | "gap")[] {
  const shown = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  return shown.flatMap((n, i) => (i > 0 && n - (shown[i - 1] as number) > 1 ? ["gap" as const, n] : [n]));
}

/** A link, or at an end the same words greyed and not a link, so the row does not jump. */
function Step({ href, children }: { href: SafeHref | null | undefined; children: ReactNode }) {
  if (href === null || href === undefined)
    return <span className={classNames(styles.item, styles.off)}>{children}</span>;
  return (
    <a className={styles.item} href={href}>
      {children}
    </a>
  );
}

export function Pagination(props: PaginationProps) {
  const nav = classNames(styles.root, props.className);
  if (!("pages" in props)) {
    return (
      <nav className={nav} aria-label={props.label ?? "Pages"}>
        <ul className={styles.list}>
          <li>
            <Step href={props.newer}>
              <Icon name="back" size={16} />
              newer
            </Step>
          </li>
          <li>
            <Step href={props.older}>
              older
              <Icon name="next" size={16} />
            </Step>
          </li>
        </ul>
      </nav>
    );
  }
  const { page, pages, hrefFor } = props;
  return (
    <nav className={nav} aria-label={props.label ?? "Pages"}>
      <ul className={styles.list}>
        <li>
          <Step href={page > 1 ? hrefFor(page - 1) : null}>
            <Icon name="back" size={16} />
            prev
          </Step>
        </li>
        {pageList(page, pages).map((n, i) =>
          n === "gap" ? (
            // A gap's place in the list is fixed by the pages around it.
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            <li key={`gap-${i}`} className={styles.gap} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={n} className={styles.number}>
              <a
                className={classNames(styles.item, n === page && styles.current)}
                href={hrefFor(n)}
                aria-current={n === page ? "page" : undefined}
              >
                {n}
              </a>
            </li>
          ),
        )}
        <li className={styles.count}>
          {page} / {pages}
        </li>
        <li>
          <Step href={page < pages ? hrefFor(page + 1) : null}>
            next
            <Icon name="next" size={16} />
          </Step>
        </li>
      </ul>
    </nav>
  );
}
