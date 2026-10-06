// Another postgres file committing by hand, in lower case.
declare const client: { query(sql: string): Promise<unknown> };
export const commit = () => client.query("commit");
