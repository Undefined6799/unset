// Existing Header brandOnly composition, without the full Header menu/island imports.
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Mark } from "../Mark/Mark.tsx";
import styles from "./Header.module.css";

export type BrandHeaderProps = { homeHref?: SafeHref; homeLabel?: string; className?: string };

export function BrandHeader({ homeHref, homeLabel = "unset.sh home", className }: BrandHeaderProps) {
  return (
    <header className={classNames(styles.root, styles.brand, className)}>
      <div className={styles.bar}>
        <a className={styles.home} href={homeHref ?? "/"}>
          <Mark width={72} title={homeLabel} />
        </a>
      </div>
    </header>
  );
}
