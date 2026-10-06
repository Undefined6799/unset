// An ORM-style transaction call.
declare const db: { transaction(fn: () => Promise<void>): Promise<void> };
export const run = () => db.transaction(async () => undefined);
