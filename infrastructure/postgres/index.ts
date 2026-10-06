// Postgres behind small contracts (P1.11): the migration runner. P1.11p adds the pool and `withTransaction`.
export { MIGRATE_LOCK_ID, type MigrateFailure, type MigrateOptions, type MigrateResult, migrate } from "./migrate.ts";
