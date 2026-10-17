// Avatar (P1.24s; sheet components/Avatar/README.md, v45; approved by Alex 2026-10-03 18:13Z): a profile picture in
// a disc with a 1px `line` hairline, or the name's first letter in `mono` on `surface-raised` when there is none.
// Decorative by default (alt=""), because the name beside it says who it is. The picture is a `SafeHref`, which the
// caller mints from the media proxy's address, never a PDS's.
import type { ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import styles from "./Avatar.module.css";

export type AvatarSize = 24 | 40 | 64 | 128;

export type AvatarProps = {
  /** The picture, already cropped square by the server. */
  src?: SafeHref | undefined;
  /** The display name or handle; its first letter is the fallback. */
  name: string;
  /** Anonymous artwork when no name or picture is available. */
  fallback?: ReactNode;
  /** 24 in lists, 40 in headers and post rows (default), 64 in cards, 128 on the profile page. */
  size?: AvatarSize;
  /** Only when no name is shown beside it. */
  alt?: string;
  className?: string;
};

/** The fallback letter: the first character of the name without a leading "@", uppercased; "?" for an empty name. */
export function avatarLetter(name: string): string {
  const first = [...name.replace(/^@/, "").trim()][0];
  return first === undefined ? "?" : first.toUpperCase();
}

export function Avatar({ src, name, fallback, size = 40, alt = "", className }: AvatarProps) {
  const disc = classNames(styles.root, styles[`size${size}`], className);
  if (src !== undefined) {
    return (
      <span className={disc}>
        <img className={styles.image} src={src} alt={alt} width={size} height={size} loading="lazy" decoding="async" />
      </span>
    );
  }
  const content = name.trim() === "" ? (fallback ?? avatarLetter(name)) : avatarLetter(name);
  if (alt === "") {
    return (
      <span className={disc} aria-hidden="true">
        {content}
      </span>
    );
  }
  return (
    <span className={disc}>
      <span aria-hidden="true">{content}</span>
      <span className="visually-hidden">{alt}</span>
    </span>
  );
}
