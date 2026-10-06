// Taking a client straight from the pool, outside pool.ts.
declare const pool: { connect(): Promise<unknown> };
export const take = () => pool.connect();
