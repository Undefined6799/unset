// FeedMore (P1.24f; sheet components/FeedMore/README.md, v45, approved by Alex 2026-10-04): the bottom of an endless
// feed. With no JS it is an `OLDER POSTS` link to the server's next cursor page, so the feed still works; the
// feed-list island (P4.21) loads the next batch in place and sets the other states: loading (the text Spinner), end
// (a plain line, no link) and error (the line plus a `try again` link that keeps the cursor). It never retries alone.
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Spinner } from "../Spinner/Spinner.tsx";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./FeedMore.module.css";

export type FeedMoreProps = {
  /** Overrides each state's words. */
  loadingText?: string;
  endText?: string;
  errorText?: string;
  className?: string;
} & (
  | { state?: "idle" | "error" /** The server's cursor link to the next batch. */; older: SafeHref }
  | { state: "loading" | "end" }
);

function Body(props: FeedMoreProps) {
  if (props.state === "loading") return <Spinner label={props.loadingText ?? "loading older posts"} />;
  if (props.state === "end" || !("older" in props))
    return (
      <span>
        <Tag>end</Tag> {props.endText ?? "you're all caught up"}
      </span>
    );
  if (props.state === "error")
    return (
      <span>
        <Tag status="err" /> {props.errorText ?? "couldn't load more"}{" "}
        <a className={styles.link} href={props.older}>
          try again
        </a>
      </span>
    );
  return (
    <a className={styles.link} href={props.older}>
      older posts
      <Icon name="down" size={16} />
    </a>
  );
}

export function FeedMore(props: FeedMoreProps) {
  return (
    <div className={classNames(styles.root, props.className)} aria-live="polite">
      <Body {...props} />
    </div>
  );
}
