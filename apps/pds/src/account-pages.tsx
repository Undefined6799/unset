// ADR 0027: presentation only. The caller owns values, translated labels and native actions.
import { type ReactNode, useEffect, useId, useRef } from "react";
import styles from "./screens/AccountPage.module.css";

export type AccountPageProps = {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

export function AccountPage({ eyebrow, title, description, children }: AccountPageProps) {
  const heading = useId();
  return (
    <section className={styles.page} aria-labelledby={heading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 id={heading}>{title}</h1>
      {description == null ? null : <div className={styles.description}>{description}</div>}
      {children}
    </section>
  );
}

export type AccountRowProps = {
  label: string;
  value: ReactNode;
  action?: ReactNode;
};

export function AccountRows({ rows }: { rows: readonly AccountRowProps[] }) {
  return (
    <ul className={styles.list}>
      {rows.map((row) => (
        <li key={row.label} className={styles.row}>
          <div>
            <div className={styles.label}>{row.label}</div>
            <div>{row.value}</div>
          </div>
          {row.action}
        </li>
      ))}
    </ul>
  );
}

export type AccountFact = { label: string; value: ReactNode };

export function AccountFacts({ facts }: { facts: readonly AccountFact[] }) {
  return (
    <dl className={styles.facts}>
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className={styles.label}>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type AccountDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function AccountDialog({ open, title, children, onClose }: AccountDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={heading} onClose={onClose}>
      <h2 id={heading}>{title}</h2>
      {children}
    </dialog>
  );
}

export function AccountForm({ children }: { children: ReactNode }) {
  return <div className={styles.form}>{children}</div>;
}

export function AccountActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
