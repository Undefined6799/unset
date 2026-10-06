// Querying a named pool and a pool held on an object.
declare const webPool: { query(sql: string): Promise<unknown> };
declare const deps: { pool: { query(sql: string): Promise<unknown> } };
export const a = () => webPool.query("SELECT 1");
export const b = () => deps.pool.query("SELECT 1");
