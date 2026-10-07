// The one thing the audit needs from Postgres (P1.15): a query on a client the caller holds, inside the caller's
// transaction for an append. A pg PoolClient satisfies it as it is, so this workspace never imports the driver or
// infrastructure/postgres (architecture matrix row `infrastructure`; rule AB-2).

export type AuditDb = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
