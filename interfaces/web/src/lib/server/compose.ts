// The web process's composition root (rule AB-2): the one place adapters are built. They are built once, by
// `startServices`, which the `init` hook runs while adapter-node's handler is imported, so before server.ts listens
// (kit 3.2.0 src/runtime/server/instance.js `init`, adapter-node 6.0.2 src/handler.js `await server.init`). Not at
// import: SvelteKit imports every server module while it builds, with no settings (kit src/core/postbuild/analyse.js).
// P1.20e: the OAuth client and what stands on it, as interfaces/http/compose.ts `composeOAuth` builds them (P2.04c,
// P1.36y, P2.13): the lock pool, the sealer, net-guard, the identity network, the handle check, the PDS call, the
// single-use nonces and the hourly sweeps. A slice that needs a new service adds it here; pages get it via `services()`.
// P2.10: the member's invites and the signed request to pds-admin that issues one (ADR 0060).
// P2.21a: the draft picture store, web's own identity in the private object store (ADR 0070).
// P2.27: the member's notification inbox and the one way to send into it (ADR 0079).
// Build step 5 (ADR 0081): each member's chat account, queued at the terms step and created through chat-admin.
// ADR 0083 decision 5, ADR 0084 decision 7: the chat devices a web session signed in end with it, through a queue.
import { createPrivateKey, type KeyObject, randomBytes } from "node:crypto";
import { type ImageProcessor, uploadsOpen } from "@unset/domains-content";
import {
  type AccountRepository,
  createDidResolver,
  createHandleVerifier,
  type Did,
  type IdentityNetwork,
  type OnboardingVersions,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "@unset/domains-identity";
import {
  type ChatAccountPorts,
  type ChatErasurePorts,
  type ChatLockPorts,
  type ChatSessionEndPorts,
  type ChatUser,
  createDueAccounts,
  endDueSessions,
  eraseDueAccounts,
  followAccountStates,
  newChatUser,
  type SignInPorts,
} from "@unset/domains-messaging";
import { type Inbox, type Notification, type NotifyResult, notify } from "@unset/domains-notifications";
import { createRemoteImageProcessor, PROCESS_PATH } from "@unset/infrastructure-image";
import {
  type ChatAdminClient,
  type ChatCountClient,
  createChatAdminClient,
  createChatCountClient,
} from "@unset/infrastructure-matrix";
import {
  createNetGuard,
  guardedFetch,
  libraryFetch,
  type NetGuard,
  objectStore,
  review,
} from "@unset/infrastructure-net-guard";
import {
  createIdentityNetwork,
  createInviteIssuer,
  createOAuthClient,
  createPdsCall,
  type IssueInviteResult,
  type SavedSession,
} from "@unset/infrastructure-pds";
import {
  type ChatAccountStore,
  type ChatErasureStore,
  type ChatLockStore,
  type ChatSessionEndStore,
  checkConnectionBudget,
  connectionOf,
  createAccountRepository,
  createChatAccountStore,
  createChatErasureStore,
  createChatLockStore,
  createChatSessionEndStore,
  createDiscoverabilityStore,
  createImageStore,
  createInviteStore,
  createLockPool,
  createNotificationStore,
  createOAuthSessionStore,
  createOAuthStateStore,
  createPool,
  createPublicProfileStore,
  createRequestLock,
  createSingleUseStore,
  type Db,
  type DiscoverabilityStore,
  type ImageStore,
  type InviteStore,
  oauthSessionExists,
  type Pool,
  type PublicProfileStore,
  ping,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer } from "@unset/infrastructure-seal";
import { createSessionStore, type SessionLimits, type SessionStore } from "@unset/infrastructure-session";
import { createObjectStore, type ObjectStore } from "@unset/infrastructure-storage";
import { createHealth, createRateLimiter, type RateLimiter } from "@unset/shared-http";
import { createLogger, type Logger } from "@unset/shared-log";
import { recordUnderageBlock } from "./age-gate-audit.ts";
import { pdsIssuerOf } from "./config.ts";
import { type EmailRefresher, emailRefresher } from "./email-refresh.ts";
import { recordInviteDenied } from "./invite-audit.ts";
import { policiesFor } from "./limits.ts";
import { publishedNote } from "./note.ts";
import { config, shutdown } from "./runtime.ts";
import { createSignInLock } from "./sign-in-lock.ts";
import { startSweeps } from "./sweeps.ts";

/** How often idle rate-limit buckets are dropped. */
const SWEEP_MS = 10_000;
/** The book's cadence for the expiry sweeps (phase-2.md P2.03 "run hourly"). */
const EXPIRY_SWEEP_MS = 3_600_000;
/** How often due chat accounts are created, and at most how many per run (build step 5). */
const CHAT_JOBS_MS = 10_000;
const CHAT_JOBS_PER_RUN = 20;
/** How often web asks chat-admin to delete idle plain rooms (ADR 0091 decision 6). */
const ROOM_SWEEP_MS = 3_600_000;
/** A claim's lease: above one job's handle check (identity timeouts, at most 10 s each) and its 8 s chat-admin call. */
const CHAT_LEASE_S = 120;
/**
 * How long after Log out the devices that session signed in are due to end (ADR 0083 decision 5): time for the tab to
 * reach unset.cc's sign-out page, wait up to 15 s for the key backup (apps/chat log-out.ts BACKUP_WAIT_MS) and log the
 * device out itself (chat-sign-out.ts). A tab that never arrives is ended by the queue then.
 */
const LOGOUT_CHAT_AFTER_S = 120;
/** Under the health check's 1 s bound (shared/http/health.ts), so the probe is ended, not left behind. */
const READINESS_MS = 900;

type OAuthClient = Awaited<ReturnType<typeof createOAuthClient>>["client"];
/** What the OAuth client keeps per sign-in in flight, read off its own option type (infrastructure/pds exports none). */
type SavedState = NonNullable<Awaited<ReturnType<Parameters<typeof createOAuthClient>[0]["stateStore"]["get"]>>>;

/** The one OAuth client and the account lock around its token sets (P2.04c, P1.36y). */
export type OAuthServices = {
  readonly client: OAuthClient;
  /** sign-in-lock.ts `during`: a sign-in holds the account's lock from storing its token set to its session row. */
  readonly signInScope: <T>(fn: () => Promise<T>) => Promise<T>;
  /** sign-in-lock.ts `exclusive`: runs `fn` holding `did`'s lock (the last browser's sign-out, sign-out everywhere). */
  readonly lockDid: <T>(did: Did, fn: () => Promise<T>) => Promise<T>;
  /** The token store's own delete, outside the lock and the library, within `deadline` (sign-out's fallback, P2.08). */
  readonly dropTokenSet: (did: Did, deadline: AbortSignal) => Promise<void>;
};

export type Services = {
  readonly log: Logger;
  readonly pool: Pool;
  readonly sessions: SessionStore;
  readonly limiter: RateLimiter;
  readonly health: ReturnType<typeof createHealth>;
  readonly oauth: OAuthServices;
  /**
   * The issuer the library recorded for a DID at sign-in (its stored token set's `iss`, read without a refresh), or
   * null. Never a DID-document field. Only for a session whose row carries no origin (`locals.issuerOrigin`).
   */
  readonly issuerOf: (did: Did, signal?: AbortSignal) => Promise<string | null>;
  /** PLC, DNS and handle domains, through net-guard. */
  readonly network: IdentityNetwork;
  /** P2.02's handle check, both directions (CLAUDE.md "Identity"). */
  readonly handles: ReturnType<typeof createHandleVerifier>;
  /** P1.16's single-use store (`login.nonce`). */
  readonly nonces: ReturnType<typeof createSingleUseStore>;
  /** Every call to a member's PDS, with the dead-grant handling (P2.07). */
  readonly pds: ReturnType<typeof createPdsCall>;
  /** Our PDS's issuer: the only one whose accounts sign in (P1.36v). */
  readonly pdsIssuer: string;
  /** Onboarding state per account (P2.12): age, terms, chat, and the under-age block with its audit row. */
  readonly accounts: AccountRepository;
  /** The terms and privacy versions this build shows (domains/identity legal/versions.ts). */
  readonly versions: OnboardingVersions;
  /** The email gate's PDS recheck and its hold (email-refresh.ts). */
  readonly email: EmailRefresher;
  /** Caches the member's email answer on this browser's session row. */
  readonly setEmailConfirmed: (idHash: Buffer, value: boolean, deadline: AbortSignal) => Promise<void>;
  /** P2.10: a member's invites (sealed codes), the request that issues one, and the audit row for a refusal. */
  readonly invites: {
    readonly store: InviteStore;
    readonly issue: (did: Did, deadline?: AbortSignal) => Promise<IssueInviteResult>;
    readonly denied: (did: Did, deadline: AbortSignal) => Promise<void>;
  };
  /**
   * P2.27 (ADR 0079): the member's inbox as this browser may see it, and the one way a source sends into it. `sendIn`
   * runs on the caller's transaction, for a source that must send with its own write (a new sign-in).
   */
  readonly notifications: {
    readonly inbox: (did: Did, idHash: Buffer, deadline: AbortSignal) => Inbox;
    readonly send: (did: Did, notification: Notification, deadline: AbortSignal) => Promise<NotifyResult>;
    readonly sendIn: (db: Db, did: Did, notification: Notification) => Promise<NotifyResult>;
    readonly withdraw: (did: Did, dedupeKey: string, deadline: AbortSignal) => Promise<void>;
  };
  /** Build step 5 (ADR 0081 decision 3): what the unset.cc sign-in hop needs to sign a member's ticket. */
  readonly chat: {
    /**
     * ADR 0083 decision 5 and ADR 0084 decision 7, on the transaction that ends the web session (or every session of
     * a DID): queues the chat devices to end, which web's job then ends through chat-admin.
     */
    readonly endFor: ChatSessionEndStore;
    readonly readyUser: (did: Did, deadline: AbortSignal) => Promise<ChatUser | null>;
    readonly signTicket: SignInPorts["sign"];
    /** Build step 10 (ADR 0090 decision 2): the member's chat count from the door's count port, or null. */
    readonly count: ChatCountClient["count"];
    /** P6.17 (ADR 0083 decision 2): whether the member has set up chat on unset.cc, or null with no clear answer. */
    readonly setUp: ChatCountClient["setUp"];
  };
  /** The public /@handle page's read of the index (P3.12s): visible accounts only (migration 0030). */
  readonly publicProfiles: PublicProfileStore;
  /** The signed-in member's own Search and AI choices (ADR 0062). */
  readonly discoverability: DiscoverabilityStore;
  /** Members' draft pictures in the private store, as web's own identity (P2.21a; ADR 0070 point 2.4). */
  readonly drafts: ObjectStore;
  /** Picture uploads (P2.19b; ADR 0070 point 2): open only where uploadsOpen allows, the rows, and review. */
  readonly images: { readonly open: boolean; readonly store: ImageStore; readonly processor: ImageProcessor };
};

/** Review's answer: the main version, the display versions and their manifest (pool.ts ANSWER_OVERHEAD). */
const REVIEW_ANSWER_BYTES = 8 * 1024 * 1024;

/**
 * Web's side of review (ADR 0070 point 2.2): POSTs through net-guard's `review` policy, one origin, with its own 30 s
 * timeout (net-guard's longest), above review's 20 s job deadline and its queue's wait.
 */
function reviewProcessor(guard: NetGuard): ImageProcessor {
  const send = guardedFetch(guard, review(config.REVIEW_URL), { timeoutMs: 30_000, maxBytes: REVIEW_ANSWER_BYTES });
  return createRemoteImageProcessor(async (bytes, headers) => {
    // fetch's BodyInit (DOM library, svelte-check) takes only an ArrayBuffer-backed view. The upload's bytes come
    // from File.arrayBuffer(), so this re-views them without a copy; anything else is a programming error.
    const { buffer } = bytes;
    if (!(buffer instanceof ArrayBuffer)) throw new TypeError("review body is not backed by an ArrayBuffer");
    const body = new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength);
    const answer = await send(new URL(PROCESS_PATH, config.REVIEW_URL), { method: "POST", body, headers });
    const contentType = answer.headers.get("content-type") ?? "";
    return { status: answer.status, contentType, body: new Uint8Array(await answer.arrayBuffer()) };
  });
}

/**
 * The rows go first, all or nothing; then each image's objects. A delete that fails is counted and thrown after the
 * rest, so the sweep logs it; those objects stay until the orphan sweep (P2.19b follow-up) finds them.
 */
async function sweepImages(store: ImageStore, drafts: ObjectStore): Promise<void> {
  const swept = await store.sweep(null);
  if (swept.kind === "refused") throw new RangeError("image sweep over its governor");
  let failed = 0;
  for (const image of swept.images) {
    const done = await drafts.deletePrefix(`drafts/${image.did}/i/${image.id}/`);
    if (!done.ok) failed += 1;
  }
  if (failed > 0) throw new Error("image sweep could not delete some objects");
}

/** web's signing key for an admin service: an Ed25519 private key, or the process does not start (exit 78 path). */
function webAdminKey(pem: string, name: "PDS_ADMIN_WEB_KEY" | "CHAT_ADMIN_WEB_KEY"): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${name} is not an Ed25519 private key`);
  return key;
}

/**
 * The queued chat account creation's ports (domains/messaging createDueAccounts): the store's claim and settle, the
 * handle check both ways (the display name is only ever a verified handle), and chat-admin.
 */
function chatAccountPorts(
  store: ChatAccountStore,
  handles: Services["handles"],
  chatAdmin: ChatAdminClient,
): ChatAccountPorts {
  return {
    claim: async () => (await store.claim(1))[0] ?? null,
    verifiedHandle: async (did) => {
      const verdict = await handles.verifyHandle(did);
      return verdict.status === "verified" ? verdict.handle : null;
    },
    create: (user, name) => chatAdmin.createAccount(user, name),
    settle: (job, settlement) => store.settle(job, settlement),
    nowMs: () => performance.now(),
  };
}

/** The queued deactivation of erased members' chat accounts (domains/messaging eraseDueAccounts; ADR 0084). */
function chatErasurePorts(store: ChatErasureStore, chatAdmin: ChatAdminClient): ChatErasurePorts {
  return {
    claim: async () => (await store.claim(1))[0] ?? null,
    deactivate: (user) => chatAdmin.deactivateAccount(user),
    finish: (job) => store.finish(job),
    retry: (job, inS) => store.retry(job, inS),
  };
}

/** Chat accounts following their members' state (domains/messaging followAccountStates; ADR 0084). */
function chatLockPorts(store: ChatLockStore, chatAdmin: ChatAdminClient): ChatLockPorts {
  return {
    claim: async () => (await store.claim(1))[0] ?? null,
    change: (user, lock) => chatAdmin.setLocked(user, lock),
    settle: (job) => store.settle(job),
    retry: (job, inS) => store.retry(job, inS),
  };
}

/** Devices queued when web ended a session (domains/messaging endDueSessions; ADR 0083, ADR 0084 decision 7). */
function chatSessionEndPorts(store: ChatSessionEndStore, chatAdmin: ChatAdminClient): ChatSessionEndPorts {
  return {
    claim: async () => (await store.claim(1))[0] ?? null,
    end: (user, device) => chatAdmin.endSession(user, device),
    finish: (job) => store.finish(job),
    retry: (job, inS) => store.retry(job, inS),
  };
}

/** The test entry's stand-ins, refused outside the test profile (note.ts `StandIns`). */
function standInsOf(): NonNullable<ReturnType<typeof publishedNote>>["standIns"] {
  const standIns = publishedNote()?.standIns;
  if (standIns !== undefined && config.UNSET_ENV !== "test") throw new Error("stand-ins outside the test profile");
  return standIns;
}

async function build(): Promise<Services> {
  const standIns = standInsOf();
  const log: Logger = createLogger({ service: "web", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
  const connection = connectionOf(config);
  const pool = createPool({
    connection,
    service: "web",
    max: config.PG_POOL_MAX,
    connectTimeoutMs: config.PG_CONNECT_TIMEOUT_MS,
  });
  const lockPool = createLockPool({ connection, service: "web-lock", max: config.LOCK_POOL_MAX, log });
  // Before anything else uses the database: the pools of every replica fit the role's connection limit.
  await withClient(pool, null, (db) =>
    checkConnectionBudget(db, [config.PG_POOL_MAX, config.LOCK_POOL_MAX], config.PG_MAX_REPLICAS),
  );
  const sessionLimits: SessionLimits = {
    idleS: config.SESSION_IDLE_S,
    absoluteS: config.SESSION_ABSOLUTE_S,
    touchIntervalS: config.SESSION_TOUCH_INTERVAL_S,
  };
  const sessions = createSessionStore({
    withDb: (deadline, fn) => withClient(pool, deadline, fn),
    limits: sessionLimits,
    log,
  });
  const limiter: RateLimiter = createRateLimiter(policiesFor(config.TRUSTED_PROXY_MODE), {
    maxKeys: config.RATE_LIMIT_MAX_KEYS,
    onError: () => log.error("ratelimit.error", {}),
  });
  const sweeper = setInterval(() => limiter.sweep(), SWEEP_MS);
  sweeper.unref();

  const guard = createNetGuard({
    internalHosts: config.NETGUARD_INTERNAL_HOSTS,
    allowLoopback: config.NETGUARD_ALLOW_LOOPBACK,
    commit: config.UNSET_COMMIT,
  });
  const plcUrl = new URL(config.PLC_URL);
  const network =
    standIns?.network ??
    createIdentityNetwork({
      guard,
      plcUrl,
      httpTimeoutMs: config.IDENTITY_HTTP_TIMEOUT_MS,
      dnsTimeoutMs: config.IDENTITY_DNS_TIMEOUT_MS,
    });
  const resolveDid = createDidResolver({
    network,
    plcUrl,
    cacheTtlS: config.DID_DOC_CACHE_TTL_S,
    cacheMax: config.DID_DOC_CACHE_MAX,
  });
  const sealer = createSealer(config.SEAL_KEYRING);
  const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer, log });
  // P1.36y: a sign-in or last-browser sign-out holds the account's OAuth lock for its whole run (sign-in-lock.ts).
  const signIn = createSignInLock({ store: tokenSets, lock: createRequestLock(lockPool) });
  const stateStore = createOAuthStateStore<SavedState>({ pool, sealer, log });
  const pdsIssuer = pdsIssuerOf(config);
  const { client } = await createOAuthClient({
    origin: config.PUBLIC_ORIGIN,
    keys: config.OAUTH_CLIENT_KEYS,
    activeKid: config.OAUTH_ACTIVE_KID,
    stateStore,
    sessionStore: signIn.tokenSets,
    requestLock: signIn.requestLock,
    fetch: standIns?.fetch ?? libraryFetch(guard),
    network,
    resolveDid,
    allowHttp: config.OAUTH_ALLOW_HTTP,
    ownIssuer: pdsIssuer,
    webKey: config.PDS_WEB_KEY,
    log,
  });
  const issuerOf = async (did: Did, signal?: AbortSignal): Promise<string | null> => {
    const saved = await tokenSets.get(did, signal === undefined ? undefined : { signal });
    const iss = saved?.tokenSet.iss;
    return typeof iss === "string" ? iss : null;
  };
  const handles = createHandleVerifier({
    network,
    resolveDid,
    verifyTtlS: config.HANDLE_VERIFY_TTL_S,
    invalidTtlS: config.HANDLE_INVALID_TTL_S,
    cacheMax: config.HANDLE_CACHE_MAX,
    onUnexpected: (error) =>
      log.warn("handle.verify_failed", { kind: error instanceof Error ? error.constructor.name : "unknown" }),
  });
  const chatSessionEnds = createChatSessionEndStore(pool, { leaseS: CHAT_LEASE_S, logoutAfterS: LOGOUT_CHAT_AFTER_S });
  const pds = createPdsCall({
    client,
    // ADR 0084 decision 7: a revoked grant ends every chat session of the account, queued with the same commit.
    endSessions: (did) =>
      withTransaction(pool, null, async (tx) => {
        await chatSessionEnds.queueForDid(tx, did);
        await sessions.destroyAllForDid(tx, did, "auth_dead");
      }),
    tokenSetRemains: (did) => oauthSessionExists(pool, did),
    log,
  });
  const nonces = createSingleUseStore({ log });
  const chatAccounts = createChatAccountStore(pool, {
    newUser: () => newChatUser((n) => randomBytes(n)),
    leaseS: CHAT_LEASE_S,
  });
  const accounts = createAccountRepository(pool, { recordUnderageBlock, chatAccounts });
  const chatAdmin = createChatAdminClient(guard, {
    origin: config.CHAT_ADMIN_URL,
    env: config.UNSET_ENV === "prod" ? "prod" : "dev",
    key: {
      kid: config.CHAT_ADMIN_WEB_KID,
      privateKey: webAdminKey(config.CHAT_ADMIN_WEB_KEY.reveal(), "CHAT_ADMIN_WEB_KEY"),
    },
  });
  const setEmailConfirmed = (idHash: Buffer, value: boolean, deadline: AbortSignal) =>
    withTransaction(pool, deadline, (tx) => sessions.setEmailConfirmed(tx, idHash, value));
  // `deadlineAt` is the request's own, on the monotonic clock: pdsCall retries a read only while it fits (P2.07a).
  const email = emailRefresher({
    sessionInfo: (did, deadline, deadlineAt) => pds.pdsSessionInfo({ memo: new Map(), deadline, deadlineAt }, did),
    setEmailConfirmed,
    now: () => performance.now(),
  });
  const invites = {
    store: createInviteStore({ pool, sealer, log }),
    issue: createInviteIssuer(guard, {
      origin: config.PDS_ADMIN_URL,
      env: config.UNSET_ENV === "prod" ? "prod" : "dev",
      pdsDid: config.PDS_DID,
      key: {
        kid: config.PDS_ADMIN_WEB_KID,
        privateKey: webAdminKey(config.PDS_ADMIN_WEB_KEY.reveal(), "PDS_ADMIN_WEB_KEY"),
      },
    }),
    denied: (did: Did, deadline: AbortSignal) => recordInviteDenied(pool, did, deadline),
  };

  const inboxRows = createNotificationStore();
  const notifications: Services["notifications"] = {
    inbox: (did, idHash, deadline) => ({
      list: (limit) => withClient(pool, deadline, (db) => inboxRows.list(db, did, idHash, limit)),
      open: (id) => withClient(pool, deadline, (db) => inboxRows.open(db, did, idHash, id)),
      openUpTo: (upTo) => withClient(pool, deadline, (db) => inboxRows.openUpTo(db, did, idHash, upTo)),
    }),
    send: (did, notification, deadline) =>
      withClient(pool, deadline, (db) => notify({ insert: (n) => inboxRows.insert(db, did, n) }, notification)),
    sendIn: (db, did, notification) => notify({ insert: (n) => inboxRows.insert(db, did, n) }, notification),
    withdraw: (did, dedupeKey, deadline) => withClient(pool, deadline, (db) => inboxRows.withdraw(db, did, dedupeKey)),
  };

  // Opens no connection here: the store is first asked when a member uploads, so a store that is down stops only that.
  const drafts = createObjectStore({
    origin: config.OBJECT_STORE_URL,
    bucket: config.OBJECT_STORE_BUCKET,
    keyId: config.OBJECT_STORE_ACCESS_ID,
    secret: config.OBJECT_STORE_SECRET.reveal(),
    fetch: guardedFetch(guard, objectStore(config.OBJECT_STORE_URL)),
  });
  const images = {
    open: uploadsOpen({ origin: config.PUBLIC_ORIGIN, env: config.UNSET_ENV, pdsHostname: config.PDS_HOSTNAME }),
    store: createImageStore(pool),
    processor: reviewProcessor(guard),
  };

  // web is the role that may delete expired sessions and sign-ins (migrations 0011, 0013; interfaces/http jobs/sweeps.ts).
  const stopSweeps = startSweeps({
    sweeps: [
      { job: "sweep.session", run: () => withClient(pool, null, (db) => sessions.sweep(db)) },
      { job: "sweep.oauth_state", run: () => stateStore.sweep() },
      { job: "sweep.single_use", run: () => withClient(pool, null, (db) => nonces.sweep(db)) },
      // P2.10: an invite's code is deleted from our row 7 days after it was made (Alex 2026-11-19).
      { job: "sweep.invite", run: () => invites.store.clearExpired() },
      // ADR 0070 point 6: pictures no save used after a day, and copies a week after their last use.
      { job: "sweep.image", run: () => sweepImages(images.store, drafts) },
      { job: "sweep.notification", run: () => withClient(pool, null, (db) => inboxRows.sweep(db)) },
    ],
    everyMs: EXPIRY_SWEEP_MS,
    log,
  });

  // Every replica runs the creations: a claim takes one row with SKIP LOCKED under a lease, so two never call for the
  // same account at once, and a call never holds a transaction or connection (rule DA-4). A chat-admin outage only
  // delays them (ADR 0084 decision 4: chat never fails the account change).
  const chatPorts = chatAccountPorts(chatAccounts, handles, chatAdmin);
  const erasurePorts = chatErasurePorts(createChatErasureStore(pool, { leaseS: CHAT_LEASE_S }), chatAdmin);
  const lockPorts = chatLockPorts(createChatLockStore(pool, { leaseS: CHAT_LEASE_S }), chatAdmin);
  const endPorts = chatSessionEndPorts(chatSessionEnds, chatAdmin);
  const stopChatJobs = startSweeps({
    sweeps: [
      {
        job: "chat-account-create",
        run: async () => {
          const counts = await createDueAccounts(chatPorts, CHAT_JOBS_PER_RUN);
          if (counts.failed > 0) log.error("chat.account_failed", { count: counts.failed });
        },
      },
      {
        job: "chat-account-erase",
        run: async () => {
          const counts = await eraseDueAccounts(erasurePorts, CHAT_JOBS_PER_RUN);
          if (counts.stuck > 0) log.error("chat.erasure_stuck", { count: counts.stuck });
        },
      },
      { job: "chat-account-lock", run: async () => void (await followAccountStates(lockPorts, CHAT_JOBS_PER_RUN)) },
      {
        job: "chat-session-end",
        run: async () => {
          const counts = await endDueSessions(endPorts, CHAT_JOBS_PER_RUN);
          if (counts.stuck > 0) log.error("chat.session_end_stuck", { count: counts.stuck });
        },
      },
    ],
    everyMs: CHAT_JOBS_MS,
    log,
  });
  // Every replica asks; chat-admin runs one sweep at a time and allows six an hour (ADR 0091 decision 1). Counts only.
  const stopRoomSweep = startSweeps({
    sweeps: [
      {
        job: "chat-room-sweep",
        run: async () => {
          const swept = await chatAdmin.sweepRooms();
          if (swept.kind === "unavailable") return log.warn("chat.rooms_sweep_failed", { reason: "unavailable" });
          log.info("chat.rooms_swept", { count: swept.deleted });
          if (swept.failed > 0) log.error("chat.rooms_sweep_failed", { count: swept.failed });
        },
      },
    ],
    everyMs: ROOM_SWEEP_MS,
    log,
  });

  const health = createHealth({
    service: config.UNSET_SERVICE,
    commit: config.UNSET_COMMIT,
    checks: [() => ping(pool, AbortSignal.timeout(READINESS_MS)).then(() => true)],
    now: () => performance.now(),
  });
  health.setState("running");
  shutdown.draining.push(() => health.setState("draining"));
  shutdown.close.push(
    async () => clearInterval(sweeper),
    async () => stopSweeps(),
    async () => stopChatJobs(),
    async () => stopRoomSweep(),
    () => pool.end(),
    () => lockPool.pool.end(),
  );
  const oauth: OAuthServices = {
    client,
    signInScope: signIn.during,
    lockDid: signIn.exclusive,
    dropTokenSet: (did, deadline) => tokenSets.del(did, { signal: deadline }),
  };
  const chatDoor = createChatCountClient(guard, config.CHAT_COUNT_URL);
  return {
    log,
    pool,
    sessions,
    limiter,
    health,
    oauth,
    issuerOf,
    network,
    handles,
    nonces,
    pds,
    pdsIssuer,
    accounts,
    versions: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION },
    email,
    setEmailConfirmed,
    invites,
    notifications,
    chat: {
      endFor: chatSessionEnds,
      readyUser: (did, deadline) => chatAccounts.readyUser(did, deadline),
      signTicket: chatAdmin.signTicket,
      count: chatDoor.count,
      setUp: chatDoor.setUp,
    },
    publicProfiles: createPublicProfileStore(pool),
    discoverability: createDiscoverabilityStore(pool),
    drafts,
    images,
  };
}

let started: Promise<Services> | undefined;
let built: Services | undefined;

/** Builds every service once; the `init` hook awaits it, so a failure stops the process before it listens. */
export async function startServices(): Promise<void> {
  started ??= build();
  built = await started;
}

/** The built services. Only after `startServices`; a call before it is a wiring bug, refused loudly. */
export const services = (): Services => {
  if (built === undefined) throw new Error("services: used before the init hook built them");
  return built;
};
