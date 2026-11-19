// The web process's composition root (rule AB-2): the one place adapters are built. They are built once, by
// `startServices`, which the `init` hook runs while adapter-node's handler is imported, so before server.ts listens
// (kit 3.2.0 src/runtime/server/instance.js `init`, adapter-node 6.0.2 src/handler.js `await server.init`). Not at
// import: SvelteKit imports every server module while it builds, with no settings (kit src/core/postbuild/analyse.js).
// P1.20e: the OAuth client and what stands on it, as interfaces/http/compose.ts `composeOAuth` builds them (P2.04c,
// P1.36y, P2.13): the lock pool, the sealer, net-guard, the identity network, the handle check, the PDS call, the
// single-use nonces and the hourly sweeps. A slice that needs a new service adds it here; pages get it via `services()`.
// P2.10: the member's invites and the signed request to pds-admin that issues one (ADR 0060).
import { createPrivateKey, type KeyObject } from "node:crypto";
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
import { createNetGuard, libraryFetch } from "@unset/infrastructure-net-guard";
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
  createInviteStore,
  createLockPool,
  createOAuthSessionStore,
  createOAuthStateStore,
  createPool,
  createPublicProfileStore,
  createRequestLock,
  createSingleUseStore,
  type DiscoverabilityStore,
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
};

export type Services = {
  readonly log: Logger;
  readonly pool: Pool;
  readonly sessions: SessionStore;
  /** The store's limits, one object, so the sign-out count reads the same idle limit (P2.08c). */
  readonly sessionLimits: SessionLimits;
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
  /** The public /@handle page's read of the index (P3.12s): visible accounts only (migration 0030). */
  readonly publicProfiles: PublicProfileStore;
  /** The signed-in member's own Search and AI choices (ADR 0062). */
  readonly discoverability: DiscoverabilityStore;
};

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

  // web is the role that may delete expired sessions and sign-ins (migrations 0011, 0013; interfaces/http jobs/sweeps.ts).
  const stopSweeps = startSweeps({
    sweeps: [
      { job: "sweep.session", run: () => withClient(pool, null, (db) => sessions.sweep(db)) },
      { job: "sweep.oauth_state", run: () => stateStore.sweep() },
      { job: "sweep.single_use", run: () => withClient(pool, null, (db) => nonces.sweep(db)) },
      // P2.10: an invite's code is deleted from our row 7 days after it was made (Alex 2026-11-19).
      { job: "sweep.invite", run: () => invites.store.clearExpired() },
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
  shutdown.draining.push(() => health.setState("draining"));
  shutdown.close.push(
    async () => clearInterval(sweeper),
    async () => stopSweeps(),
    () => pool.end(),
    () => lockPool.pool.end(),
  );
  const oauth: OAuthServices = {
    client,
    signInScope: signIn.during,
    lockDid: signIn.exclusive,
  };
  return {
    log,
    pool,
    sessions,
    sessionLimits,
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
    publicProfiles: createPublicProfileStore(pool),
    discoverability: createDiscoverabilityStore(pool),
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
