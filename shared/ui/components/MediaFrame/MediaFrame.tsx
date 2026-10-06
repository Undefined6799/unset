// MediaFrame (P1.24s; sheet components/MediaFrame/README.md, v45; approved by Alex 2026-10-04): a picture at one of
// five fixed shapes, cropped to fill, with 2px corners, a `line` hairline and an optional caption. The shape comes
// from the prop, never from the picture, so nothing moves when it loads; with no picture it shows `[no image]`.
import type { ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import styles from "./MediaFrame.module.css";

/** 1:1 post grids, 4:5 portrait photos, 9:16 video covers, 16:9 landscape, 3:1 profile cover. */
export type MediaRatio = "1:1" | "4:5" | "9:16" | "16:9" | "3:1";

const RATIO_CLASS: Readonly<Record<MediaRatio, string | undefined>> = {
  "1:1": styles.ratio1x1,
  "4:5": styles.ratio4x5,
  "9:16": styles.ratio9x16,
  "16:9": styles.ratio16x9,
  "3:1": styles.ratio3x1,
};

export type MediaFrameProps = {
  /** The picture, a `SafeHref` minted from the media proxy's address. */
  src?: SafeHref | undefined;
  /** Describe the picture, or "" when it is only decoration. */
  alt: string;
  ratio?: MediaRatio;
  caption?: ReactNode;
  emptyText?: string;
  className?: string;
};

export function MediaFrame({ src, alt, ratio = "1:1", caption, emptyText = "[no image]", className }: MediaFrameProps) {
  return (
    <figure className={classNames(styles.root, className)}>
      <div className={classNames(styles.box, RATIO_CLASS[ratio])}>
        {src === undefined ? (
          <span className={styles.empty}>{emptyText}</span>
        ) : (
          <img className={styles.image} src={src} alt={alt} loading="lazy" decoding="async" />
        )}
      </div>
      {caption === undefined ? null : <figcaption className={styles.caption}>{caption}</figcaption>}
    </figure>
  );
}
