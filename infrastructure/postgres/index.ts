// Postgres behind small contracts: the migration runner (P1.11), the pool and transactions (P1.11p), role password
// sync (P1.12p), the DID-column catalog query (P1.13), the single-use store (P1.16), the advisory lock (P1.17), the
// sealed column registry and rewrapAll (P1.14d).
export { type AccountRepositoryOptions, type BlockTransaction, createAccountRepository } from "./accountRepository.ts";
export {
  type AccountHealth,
  type AccountJob,
  type AccountJobKind,
  type AccountStore,
  type ConfirmedStatus,
  confirmDelaySeconds,
  createAccountStore,
  MAX_CONFIRM_DAYS,
} from "./accountStore.ts";
export { createBrowserListStore } from "./browserListStore.ts";
export { type ChatAccountStore, type ChatAccountStoreOptions, createChatAccountStore } from "./chatAccountStore.ts";
export { createChatContactStore } from "./chatContactStore.ts";
export { type ChatErasureStore, createChatErasureStore } from "./chatErasureStore.ts";
export { type ChatLockStore, createChatLockStore } from "./chatLockStore.ts";
export { connectionOf, lockPoolFields, type PostgresConfig, poolFields, postgresFields } from "./config.ts";
export { type DidColumn, type DidColumnKind, didColumns } from "./didColumns.ts";
export { createDiscoverabilityStore, type DiscoverabilityStore } from "./discoverabilityStore.ts";
export {
  createHandleStore,
  HANDLE_LEASE_SECONDS,
  HANDLE_RETRY_SECONDS,
  type HandleJob,
  type HandleOutcome,
  type HandleStore,
} from "./handleStore.ts";
export {
  createImageStore,
  type ImageKind,
  type ImageStore,
  type LibraryImage,
  type StoredImage,
  type SweepResult,
} from "./imageStore.ts";
export {
  createIndexStore,
  INGEST_COUNTERS,
  type IndexFrame,
  type IndexHealth,
  type IndexStore,
  type IndexStoreOptions,
  isDatabaseUnavailable,
} from "./indexStore.ts";
export { createInviteStore, type InviteListItem, type InviteStore } from "./inviteStore.ts";
export {
  createLockPool,
  createRequestLock,
  LockError,
  type LockErrorCode,
  LockNamespace,
  type LockPool,
  withAdvisoryLock,
} from "./lock.ts";
export {
  MIGRATE_LOCK_ID,
  type MigrateFailure,
  type MigrateOptions,
  type MigrateResult,
  type MigrateServiceResult,
  migrate,
  migrateThenSyncPasswords,
} from "./migrate.ts";
export { createNotificationStore, type NotificationStore } from "./notificationStore.ts";
export {
  createOAuthSessionStore,
  createOAuthStateStore,
  type OAuthStateStore,
  oauthSessionExists,
  type SealedStore,
} from "./oauthStores.ts";
export {
  acquire,
  checkConnectionBudget,
  createPool,
  type Pool,
  type PoolClient,
  type PoolOptions,
  ping,
  withClient,
} from "./pool.ts";
export {
  createPublicProfileStore,
  type ListedPage,
  type PublicActor,
  type PublicProfile,
  type PublicProfileStore,
} from "./publicProfileStore.ts";
export { createPushKeyStore } from "./pushKeyStore.ts";
export { checkExit, type KidCounts, kidCounts, rewrapAll } from "./rewrapAll.ts";
export {
  type PasswordSyncOptions,
  type PasswordSyncResult,
  type RosterEntry,
  syncRolePasswords,
} from "./roles.ts";
export {
  type CatalogColumn,
  SEALED_COLUMNS,
  type SealedColumnId,
  type SealedForm,
  type SealedRegistry,
  type SealedRow,
  sealedColumns,
} from "./sealedColumns.ts";
export { createSetupClaimStore } from "./setupClaimStore.ts";
export {
  createSingleUseStore,
  type Db,
  type ExternalId,
  PURPOSES,
  type Purpose,
  type SingleUseStore,
} from "./singleUse/store.ts";
export {
  type BackfillFailure,
  type BackfillJob,
  backfillDelaySeconds,
  createTrackStore,
  MAX_BACKFILL_ATTEMPTS,
  type TrackOutcome,
  type TrackStore,
} from "./trackStore.ts";
export { type Isolation, withTransaction } from "./tx.ts";
