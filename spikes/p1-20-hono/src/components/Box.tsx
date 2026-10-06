import type { ReactNode } from "react";
import styles from "./Box.module.css";

export function Box({ children }: { children: ReactNode }) {
  return <div className={styles.box}>{children}</div>;
}
