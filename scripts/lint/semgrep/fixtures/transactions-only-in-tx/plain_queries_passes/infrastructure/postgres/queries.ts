// Ordinary statements and words that only contain the keywords.
declare const client: { query(sql: string, values?: unknown[]): Promise<unknown> };
export const read = () => client.query("SELECT version FROM schema_migrations WHERE version = $1", [1]);
export const label = "beginner commits";
export const note = "SELECT 'BEGIN'";
export const call = (tx: { begin(): void }) => tx.begin();
