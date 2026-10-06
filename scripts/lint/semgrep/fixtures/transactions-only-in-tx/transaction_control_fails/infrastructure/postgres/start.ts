// START TRANSACTION with an isolation level, as a template literal.
declare const client: { query(sql: string): Promise<unknown> };
export const start = () => client.query(`START TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
