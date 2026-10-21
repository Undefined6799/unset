import { type ReactNode, useId } from "react";
import styles from "./screens/Devices.module.css";

export type DevicesProps = {
  eyebrow: string;
  title: string;
  description: ReactNode;
  filter?: ReactNode;
  deviceLabel: ReactNode;
  lastSeenLabel: ReactNode;
  actionsLabel: string;
  children: ReactNode;
};

export function Devices({
  eyebrow,
  title,
  description,
  filter,
  deviceLabel,
  lastSeenLabel,
  actionsLabel,
  children,
}: DevicesProps) {
  const heading = useId();
  return (
    <section className={styles.page} aria-labelledby={heading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 id={heading}>{title}</h1>
      <div className={styles.description}>{description}</div>
      {filter == null ? null : <div className={styles.filter}>{filter}</div>}
      <table className={styles.table} aria-labelledby={heading}>
        <thead>
          <tr className={styles.row}>
            <th scope="col">{deviceLabel}</th>
            <th scope="col">{lastSeenLabel}</th>
            <th scope="col">
              <span className="visually-hidden">{actionsLabel}</span>
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

export type DeviceRowProps = {
  name: ReactNode;
  status: ReactNode;
  lastSeen: ReactNode;
  lastSeenLabel: ReactNode;
  ipAddress?: ReactNode;
  ipAddressLabel?: ReactNode;
  action: ReactNode;
};

export function DeviceRow({
  name,
  status,
  lastSeen,
  lastSeenLabel,
  ipAddress,
  ipAddressLabel,
  action,
}: DeviceRowProps) {
  return (
    <tr className={styles.row}>
      <td>
        <div className={styles.information}>
          <div>{name}</div>
          <div className={styles.status}>{status}</div>
          {ipAddress == null ? null : (
            <dl className={styles.ip}>
              <dt>{ipAddressLabel}</dt>
              <dd>{ipAddress}</dd>
            </dl>
          )}
        </div>
      </td>
      <td className={styles.seen}>
        <span className={styles.mobileLabel}>{lastSeenLabel}: </span>
        {lastSeen}
      </td>
      <td className={styles.action}>{action}</td>
    </tr>
  );
}
