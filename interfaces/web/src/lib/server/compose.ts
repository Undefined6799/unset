// The web process's composition root (rule AB-2): the one place adapters are built. They are built once, by
// `startServices`, which the `init` hook runs while adapter-node's handler is imported, so before server.ts listens
// (kit 3.2.0 src/runtime/server/instance.js `init`, adapter-node 6.0.2 src/handler.js `await server.init`). Not at
// import: SvelteKit imports every server module while it builds, with no settings (kit src/core/postbuild/analyse.js).
// P1.20e: the OAuth client and what stands on it, as interfaces/http/compose.ts `composeOAuth` builds them (P2.04c,
// P1.36y, P2.13): the lock pool, the sealer, net-guard, the identity network, the handle check, the PDS call, the
// single-use nonces and the hourly sweeps. A slice that needs a new service adds it here; pages get it via `services()`.
// P2.10: the member's invites and the signed request to pds-admin that issues one (ADR 0060).
// P2.21a: the draft picture store, web's own identity in the private object store (ADR 0070).
// P2.10r: invite requests, the in-memory ask window and the owner's mail over SMTP (ADR 0080), when switched on.
// P2.27: the member's notification inbox and the one way to send into it (ADR 0079).
import { createPrivateKey, type KeyObject } from "node:crypto";
import { type ImageProcessor, uploadsOpen } from "@unset/domains-content";
import {
  type AccountRepository,
  createDidResolver,
  createHandleVerifier,
  type Did,
  type IdentityNetwork,
  type OnboardingVersions,
  PRIVACY_VERSION,
  type SignInHistory,
  TERMS_VERSION,
} from "@unset/domains-identity";
import { type Inbox, type Notification, type NotifyResult, notify } from "@unset/domains-notifications";
import { createSmtpMailer, type Mailer, parseSmtpUrl } from "@unset/infrastructure-email";
import { createRemoteImageProcessor, PROCESS_PATH } from "@unset/infrastructure-image";
import {
  createNetGuard,
  guardedFetch,
  libraryFetch,
  type NetGuard,
  objectStoreFetch,
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
  checkConnectionBudget,
  connectionOf,
  createAccountRepository,
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
  createSignInStore,
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
import { sweepOrphanImages } from "./image-orphans.ts";
import { recordInviteDenied } from "./invite-audit.ts";
import { type AskWindow, createAskWindow, createPendingSends, type PendingSends } from "./invite-requests.ts";
import { policiesFor, TEXT_READ_LIMITS } from "./limits.ts";
import { publishedNote } from "./note.ts";
import { config, shutdown } from "./runtime.ts";
import { createSignInLock } from "./sign-in-lock.ts";
import { startSweeps } from "./sweeps.ts";
import { createTextReads, type TextReads } from "./text-reader.ts";

/** How often idle rate-limit buckets are dropped. */
const SWEEP_MS = 10_000;
/** The book's cadence for the expiry sweeps (phase-2.md P2.03 "run hourly"). */
const EXPIRY_SWEEP_MS = 3_600_000;
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
  /** The reader of Text cards and what it remembers between page loads (text-reader.ts). */
  readonly textReads: TextReads;
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
  /**
   * P2.27c (ADR 0082): the member's sign-in history as this browser may see and delete it, and the write the OAuth
   * callback makes on its own transaction.
   */
  readonly signIns: {
    readonly history: (did: Did, deadline: AbortSignal) => SignInHistory;
    readonly recordIn: (db: Db, did: Did) => Promise<void>;
  };
  /** The public /@handle page's read of the index (P3.12s): visible accounts only (migration 0030). */
  readonly publicProfiles: PublicProfileStore;
  /** The signed-in member's own Search and AI choices (ADR 0062). */
  readonly discoverability: DiscoverabilityStore;
  /** Members' draft pictures in the private store, as web's own identity (P2.21a; ADR 0070 point 2.4). */
  readonly drafts: ObjectStore;
  /** Picture uploads (P2.19b; ADR 0070 point 2): open only where uploadsOpen allows, the rows, and review. */
  readonly images: { readonly open: boolean; readonly store: ImageStore; readonly processor: ImageProcessor };
  /** Invite requests (P2.10r; ADR 0080): null when INVITE_REQUESTS is off; else the ask window, mailer and owner. */
  readonly inviteRequests: InviteRequests | null;
};

export type InviteRequests = {
  readonly window: AskWindow;
  readonly mailer: Mailer;
  readonly to: string;
  /** Mails still going after their answer; shutdown waits for them. */
  readonly pending: PendingSends;
};

/** Each SMTP wait (connect, greeting, idle); the route's 20 s deadline bounds the whole send (policy.ts). */
const MAIL_TIMEOUT_MS = 8000;

/** The invite-request services, or null when off. config.ts's rules have checked all three values when on. */
function inviteRequestsOf(): InviteRequests | null {
  const { INVITE_REQUESTS: on, INVITE_REQUEST_SMTP_URL: url, INVITE_REQUEST_TO: to } = config;
  if (on !== "on") return null;
  const server = url === undefined ? null : parseSmtpUrl(url.reveal());
  if (server === null || to === undefined) throw new Error("invite requests: on without their settings");
  return {
    window: createAskWindow({ now: () => Date.now() }),
    mailer: createSmtpMailer({ server, from: config.INVITE_REQUEST_FROM, timeoutMs: MAIL_TIMEOUT_MS }),
    to: to.reveal(),
    pending: createPendingSends(),
  };
}

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
 * rest, so the sweep logs it; those objects stay until the orphan sweep (image-orphans.ts) finds them.
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

/** web's signing key for pds-admin: an Ed25519 private key, or the process does not start (exit 78 path). */
function webAdminKey(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("PDS_ADMIN_WEB_KEY is not an Ed25519 private key");
  return key;
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
  const pds = createPdsCall({
    client,
    endSessions: (did) =>
      withTransaction(pool, null, (tx) => sessions.destroyAllForDid(tx, did, "auth_dead")).then(() => undefined),
    tokenSetRemains: (did) => oauthSessionExists(pool, did),
    log,
  });
  const nonces = createSingleUseStore({ log });
  const accounts = createAccountRepository(pool, { recordUnderageBlock });
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
      key: { kid: config.PDS_ADMIN_WEB_KID, privateKey: webAdminKey(config.PDS_ADMIN_WEB_KEY.reveal()) },
    }),
    denied: (did: Did, deadline: AbortSignal) => recordInviteDenied(pool, did, deadline),
  };

  const inboxRows = createNotificationStore();
  const notifications: Services["notifications"] = {
    inbox: (did, idHash, deadline) => ({
      list: (limit) => withClient(pool, deadline, (db) => inboxRows.list(db, did, idHash, limit)),
      dismiss: (ids) => withClient(pool, deadline, (db) => inboxRows.dismiss(db, did, idHash, ids)),
      dismissUpTo: (upTo) => withClient(pool, deadline, (db) => inboxRows.dismissUpTo(db, did, idHash, upTo)),
      markSeen: (upTo) => withClient(pool, deadline, (db) => inboxRows.markSeen(db, did, idHash, upTo)),
    }),
    send: (did, notification, deadline) =>
      withClient(pool, deadline, (db) => notify({ insert: (n) => inboxRows.insert(db, did, n) }, notification)),
    sendIn: (db, did, notification) => notify({ insert: (n) => inboxRows.insert(db, did, n) }, notification),
    withdraw: (did, dedupeKey, deadline) => withClient(pool, deadline, (db) => inboxRows.withdraw(db, did, dedupeKey)),
  };

  const signInRows = createSignInStore();
  const signIns: Services["signIns"] = {
    history: (did, deadline) => ({
      list: (limit) => withClient(pool, deadline, (db) => signInRows.list(db, did, limit)),
      remove: (ids) => withClient(pool, deadline, (db) => signInRows.remove(db, did, ids)),
      removeUpTo: (upTo) => withClient(pool, deadline, (db) => signInRows.removeUpTo(db, did, upTo)),
    }),
    recordIn: (db, did) => signInRows.record(db, did),
  };

  // Opens no connection here: the store is first asked when a member uploads, so a store that is down stops only that.
  const drafts = createObjectStore({
    origin: config.OBJECT_STORE_URL,
    bucket: config.OBJECT_STORE_BUCKET,
    keyId: config.OBJECT_STORE_ACCESS_ID,
    secret: config.OBJECT_STORE_SECRET.reveal(),
    // Its answer is capped as its put is (ADR 0088): the default 1 MiB once failed any main version past 1,048,576 bytes.
    fetch: objectStoreFetch(guard, config.OBJECT_STORE_URL),
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
      // P2.19b: objects a failed delete left behind, once their rows are gone (image-orphans.ts).
      {
        job: "sweep.image_orphan",
        run: () => sweepOrphanImages(drafts, { named: (ids) => images.store.named(ids, null) }),
      },
      { job: "sweep.notification", run: () => withClient(pool, null, (db) => inboxRows.sweep(db)) },
      { job: "sweep.sign_in", run: () => withClient(pool, null, (db) => signInRows.sweep(db)) },
    ],
    everyMs: EXPIRY_SWEEP_MS,
    log,
  });

  const health = createHealth({
    service: config.UNSET_SERVICE,
    commit: config.UNSET_COMMIT,
    checks: [() => ping(pool, AbortSignal.timeout(READINESS_MS)).then(() => true)],
    now: () => performance.now(),
  });
  health.setState("running");
  const inviteRequests = inviteRequestsOf();
  shutdown.draining.push(() => health.setState("draining"));
  shutdown.close.push(
    async () => clearInterval(sweeper),
    async () => stopSweeps(),
    () => pool.end(),
    () => lockPool.pool.end(),
  );
  // A mail sent after its answer still goes once a deploy stops web (ADR 0080 point 4).
  if (inviteRequests !== null) shutdown.close.unshift(() => inviteRequests.pending.settled());
  const oauth: OAuthServices = {
    client,
    signInScope: signIn.during,
    lockDid: signIn.exclusive,
    dropTokenSet: (did, deadline) => tokenSets.del(did, { signal: deadline }),
  };
  return {
    log,
    pool,
    sessions,
    limiter,
    textReads: createTextReads(TEXT_READ_LIMITS),
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
    signIns,
    publicProfiles: createPublicProfileStore(pool),
    discoverability: createDiscoverabilityStore(pool),
    drafts,
    images,
    inviteRequests,
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
