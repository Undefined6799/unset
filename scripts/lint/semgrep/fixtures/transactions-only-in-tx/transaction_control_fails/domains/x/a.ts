// A domain opening a transaction itself.
declare const client: { query(sql: string): Promise<unknown> };
export const open = () => client.query("BEGIN");
