// ADR 0027: presentation only. The caller owns fields, validation and the native submit action.
import { BrandHeader } from "@unset/shared-ui/brand-header";
import type { SafeHref } from "@unset/shared-ui/presentation";
import { type ReactNode, useId } from "react";
import styles from "./screens/AuthPage.module.css";

export type AuthPanelProps = {
  homeHref: SafeHref;
  homeLabel: string;
  title: string;
  description?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  links?: ReactNode;
};

export function AuthPanel({ homeHref, homeLabel, title, description, error, children, links }: AuthPanelProps) {
  const heading = useId();
  return (
    <div className={styles.root}>
      <BrandHeader homeHref={homeHref} homeLabel={homeLabel} />
      <main id="main" tabIndex={-1} className={styles.main} aria-labelledby={heading}>
        <h1 id={heading}>{title}</h1>
        {description == null ? null : <div className={styles.description}>{description}</div>}
        {error == null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.form}>{children}</div>
        {links == null ? null : <div className={styles.links}>{links}</div>}
      </main>
    </div>
  );
}
