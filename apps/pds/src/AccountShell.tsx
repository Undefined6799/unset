// ADR 0027 §3: presentation only; the caller owns routes, translated content and native controls.
import { BrandHeader } from "@unset/shared-ui/brand-header";
import { Navigation, type NavigationProps } from "@unset/shared-ui/presentation";
import type { ReactNode } from "react";
import styles from "./screens/AccountShell.module.css";

export type AccountShellProps = {
  navigation: Omit<NavigationProps, "inline" | "itemsPlacement">;
  homeLabel: string;
  skipLabel: string;
  nativeActions?: ReactNode;
  prepend?: ReactNode;
  children: ReactNode;
};

export function AccountShell({
  navigation,
  homeLabel,
  skipLabel,
  nativeActions,
  prepend,
  children,
}: AccountShellProps) {
  return (
    <div className={styles.root}>
      <a className={styles.skip} href="#main">
        {skipLabel}
      </a>
      <BrandHeader homeHref={navigation.account.href} homeLabel={homeLabel} className={styles.header ?? ""} />
      <Navigation {...navigation} itemsPlacement="start" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.content}>
          {prepend}
          {children}
          {nativeActions}
        </div>
      </main>
    </div>
  );
}
