// Postgres behind small contracts: the migration runner (P1.11), the pool and transactions (P1.11p), role password
// sync (P1.12p), the DID-column catalog query (P1.13), the single-use store (P1.16), the advisory lock (P1.17).
export { connectionOf, lockPoolFields, type PostgresConfig, poolFields, postgresFields } from "./config.ts";
export { type DidColumn, type DidColumnKind, didColumns } from "./didColumns.ts";
export {
  createLockPool,
  createRequestLock,
  LockError,
  type LockErrorCode,
  LockNamespace,
  type LockPool,
  withAdvisoryLock,
} from "./lock.ts";
export { MIGRATE_LOCK_ID, type MigrateFailure, type MigrateOptions, type MigrateResult, migrate } from "./migrate.ts";
export {
  acquire,
  checkConnectionBudget,
  createPool,
  type Pool,
  type PoolClient,
  type PoolOptions,
  withClient,
} from "./pool.ts";
export {
  type PasswordSyncOptions,
  type PasswordSyncResult,
  type RosterEntry,
  syncRolePasswords,
} from "./roles.ts";
export {
  createSingleUseStore,
  type Db,
  type ExternalId,
  PURPOSES,
  type Purpose,
  type SingleUseStore,
} from "./singleUse/store.ts";
export { type Isolation, withTransaction } from "./tx.ts";
