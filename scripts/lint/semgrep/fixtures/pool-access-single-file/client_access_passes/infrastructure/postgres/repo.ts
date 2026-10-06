// Queries on a client handed out by withClient, and connect on things that are not pools.
type Client = { query(sql: string): Promise<unknown> };
declare const withClient: (fn: (client: Client) => Promise<unknown>) => Promise<unknown>;
declare const socket: { connect(): void };
declare const spool: { query(): void };
export const read = () => withClient((client) => client.query("SELECT 1"));
export const open = () => socket.connect();
export const odd = () => spool.query();
