// NewPosts (P1.24f; sheet components/NewPosts/README.md, v45, approved by Alex 2026-10-04): the status bar under the
// header, written as a terminal line, `[info] 3 new posts  SHOW ↑`. Only the feed-list island (P4.21) renders it, so a
// page with no JS shows nothing; SHOW is still a real link to the feed's own address, which reloads it at the top.
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./NewPosts.module.css";

export type NewPostsProps = {
  /** How many posts are waiting. */
  count: number;
  /** The feed's own address. */
  href: SafeHref;
  /** Slid away while the reader scrolls up; the feed island sets it. */
  hidden?: boolean;
  /** In place instead of sticky, for the showcase. */
  inline?: boolean;
  className?: string;
};

/** "1 new post", "3 new posts", "99+ new posts" above 99. */
export function newPostsText(count: number): string {
  if (count === 1) return "1 new post";
  return `${count > 99 ? "99+" : count} new posts`;
}

export function NewPosts({ count, href, hidden, inline, className }: NewPostsProps) {
  return (
    <div
      className={classNames(styles.root, inline === true && styles.inline, hidden === true && styles.hidden, className)}
    >
      <span>
        <Tag status="info" /> {newPostsText(count)}
      </span>
      <a className={styles.show} href={href}>
        show
        <Icon name="up" size={16} />
      </a>
    </div>
  );
}
