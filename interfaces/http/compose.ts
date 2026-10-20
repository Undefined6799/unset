// The composition root of the web server (unset.sh) (P1.04; rules TE-1, AB-2): the only file that builds adapters.
// P1.23 reads apps/web's build once here; the same parse feeds the assets route and every page render. P1.23c: the
// render is apps/web's server build, loaded once, unless the caller passes one. main.ts never does, so production
// runs only the build and its import graph holds no app source (architecture Amendment 2026-10-06 21:05Z); tests
// pass the source, which only Vitest can compile (it has import.meta.glob and CSS Modules).
// P2.04c: the one OAuth client, on `web`'s pools, the seal keyring, net-guard and the identity domain. Building opens no
// connection; `boot` checks the connection budget before the server listens. P2.05: the sign-in routes on that client,
// the identity network and P1.16's nonces. P2.06: the callback, which creates P2.03 sessions on the same pool. P2.08
// and P2.08a: this browser and the last browser's grant (P2.08d removed sign-out everywhere). P2.13: the signed-in
// home, with P2.02's handle check on the same DID resolver. P1.25: the public pages, and the kit's error-page hook on
// apps/web's error page. P1.25c: the test-only pages, imported only when TEST_ROUTES is on, so no deployed process
// loads them.
import { fileURLToPath } from "node:url";
import {
  createDidResolver,
  createHandleVerifier,
  type Did,
  type EmailCache,
  PRIVACY_VERSION,
  resolveHandle,
  TERMS_VERSION,
} from "@unset/domains-identity";
import { createNetGuard, libraryFetch } from "@unset/infrastructure-net-guard";
import {
  authorize,
  completeAuthorization,
  createIdentityNetwork,
  createOAuthClient,
  createPdsCall,
  type SavedSession,
} from "@unset/infrastructure-pds";
import {
  checkConnectionBudget,
  connectionOf,
  createLockPool,
  createOAuthSessionStore,
  createOAuthStateStore,
  createPool,
  createRequestLock,
  createSingleUseStore,
  PURPOSES,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer } from "@unset/infrastructure-seal";
import { createSessionStore, type Session } from "@unset/infrastructure-session";
import type { Config } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger, type Logger } from "@unset/shared-log";
import { createAccountStore } from "./account.ts";
import type { AppGate } from "./app-gate.ts";
import { openApp } from "./app-gate.ts";
import type { config } from "./config.ts";
import { emailRefresh } from "./email-refresh.ts";
import { policies } from "./limits.ts";
import { browserLogout } from "./logout-sessions.ts";
import { assetsRoutes } from "./routes/assets.ts";
import { homeRoutes } from "./routes/home.ts";
import { legalRoutes } from "./routes/legal.ts";
import { loginRoutes } from "./routes/login.ts";
import { logoutRoutes } from "./routes/logout.ts";
import { meRoutes } from "./routes/me.ts";
import { oauthCallbackRoutes } from "./routes/oauth-callback.ts";
import { oauthMetadataRoutes } from "./routes/oauth-metadata.ts";
import { prefsRoutes } from "./routes/prefs.ts";
import { securityTxtRoutes } from "./routes/security-txt.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { verifyEmailRoutes } from "./routes/verify-email.ts";
import { welcomeRoutes } from "./routes/welcome.ts";
import { sessionCookieValue } from "./session-cookie.ts";
import { loadWebBuild } from "./web/build.ts";
import { errorPageHook, type PageDeps, pageResponse } from "./web/page.ts";
import { loadWebRender, type WebRender } from "./web/render-entry.ts";

type WebConfig = Config<(typeof config)["fields"]>;

export type Services = {
  server: ReturnType<typeof createServer>;
  /** Renders a page; the page routes (P1.25 onwards) call it. */
  page: (page: Parameters<typeof pageResponse>[1]) => Response;
  /** The OAuth client the sign-in routes (P2.05, P2.06) take. */
  oauth: Awaited<ReturnType<typeof createOAuthClient>>["client"];
  /** Boot checks that need the database, run once before the server listens. */
  boot: () => Promise<void>;
};

/** `web`'s two pools, the OAuth client over them, and what closes them; nothing here opens a connection. */
async function composeOAuth(cfg: WebConfig, log: Logger) {
  const connection = connectionOf(cfg);
  const pool = createPool({
    connection,
    service: "web",
    max: cfg.PG_POOL_MAX,
    connectTimeoutMs: cfg.PG_CONNECT_TIMEOUT_MS,
  });
  const lockPool = createLockPool({ connection, service: "web-lock", max: cfg.LOCK_POOL_MAX, log });
  const sealer = createSealer(cfg.SEAL_KEYRING);
  const guard = createNetGuard({
    internalHosts: cfg.NETGUARD_INTERNAL_HOSTS,
    allowLoopback: cfg.NETGUARD_ALLOW_LOOPBACK,
    commit: cfg.UNSET_COMMIT,
  });
  const plcUrl = new URL(cfg.PLC_URL);
  const network = createIdentityNetwork({
    guard,
    plcUrl,
    httpTimeoutMs: cfg.IDENTITY_HTTP_TIMEOUT_MS,
    dnsTimeoutMs: cfg.IDENTITY_DNS_TIMEOUT_MS,
  });
  const resolveDid = createDidResolver({
    network,
    plcUrl,
    cacheTtlS: cfg.DID_DOC_CACHE_TTL_S,
    cacheMax: cfg.DID_DOC_CACHE_MAX,
  });
  const sessionStore = createOAuthSessionStore<SavedSession>({ pool, sealer, log });
  const { client } = await createOAuthClient({
    origin: cfg.PUBLIC_ORIGIN,
    keys: cfg.OAUTH_CLIENT_KEYS,
    activeKid: cfg.OAUTH_ACTIVE_KID,
    stateStore: createOAuthStateStore({ pool, sealer, log }),
    sessionStore,
    requestLock: createRequestLock(lockPool),
    fetch: libraryFetch(guard),
    network,
    resolveDid,
    allowHttp: cfg.OAUTH_ALLOW_HTTP,
    log,
  });
  const boot = () =>
    withClient(pool, null, (db) =>
      checkConnectionBudget(db, [cfg.PG_POOL_MAX, cfg.LOCK_POOL_MAX], cfg.PG_MAX_REPLICAS),
    );
  return {
    client,
    network,
    resolveDid,
    pool,
    sessionStore,
    boot,
    onClose: [() => pool.end(), () => lockPool.pool.end()],
  };
}

const DEFAULT_WEB_BUILD = fileURLToPath(new URL("../../apps/web/dist/client/", import.meta.url));
export async function compose(cfg: WebConfig, web?: WebRender): Promise<Services> {
  // P1.25c: the test-only pages load only when TEST_ROUTES is on, which the config allows only under test. First, so a
  // start that gets past the config has already passed this point (main.test.ts).
  const testRoutes = cfg.TEST_ROUTES ? (await import("./routes/test-routes.ts")).testRoutes : undefined;
  const log = createLogger({ service: cfg.UNSET_SERVICE, commit: cfg.UNSET_COMMIT, env: cfg.UNSET_ENV });
  const render = web ?? (await loadWebRender());
  const build = loadWebBuild(cfg.WEB_BUILD_DIR === "" ? DEFAULT_WEB_BUILD : cfg.WEB_BUILD_DIR, render.islandName);
  const deps: PageDeps = {
    build,
    render: render.renderPage,
    assetsOrigin: new URL(cfg.ASSETS_BASE === "" ? cfg.PUBLIC_ORIGIN : cfg.ASSETS_BASE).origin,
    env: cfg.UNSET_ENV,
    log,
  };
  const oauth = await composeOAuth(cfg, log);
  const page: Services["page"] = (input) => pageResponse(deps, input);
  const nonces = createSingleUseStore({ log });
  // One object for the store and the sign-out count (P2.08c), so the two cannot read different idle limits.
  const sessionLimits = {
    idleS: cfg.SESSION_IDLE_S,
    absoluteS: cfg.SESSION_ABSOLUTE_S,
    touchIntervalS: cfg.SESSION_TOUCH_INTERVAL_S,
  };
  const sessions = createSessionStore({
    withDb: (deadline, fn) => withClient(oauth.pool, deadline, fn),
    limits: sessionLimits,
    log,
  });
  const readSession = (request: Request, deadline: AbortSignal) => {
    const cookieValue = sessionCookieValue(request.headers.get("cookie"));
    return sessions.read({ key: request, cookieValue, deadline });
  };
  const handles = createHandleVerifier({
    network: oauth.network,
    resolveDid: oauth.resolveDid,
    verifyTtlS: cfg.HANDLE_VERIFY_TTL_S,
    invalidTtlS: cfg.HANDLE_INVALID_TTL_S,
    cacheMax: cfg.HANDLE_CACHE_MAX,
    onUnexpected: (error) =>
      log.warn("handle.verify_failed", { kind: error instanceof Error ? error.constructor.name : "unknown" }),
  });
  const login = loginRoutes({
    page,
    screens: render.screens,
    safeHref: render.safeHref,
    readSession,
    resolveHandle: (handle) => resolveHandle(oauth.network, handle),
    issueNonce: (deadline) =>
      withClient(oauth.pool, deadline, (db) => nonces.issue(db, "login.nonce", { ttlS: PURPOSES["login.nonce"] })),
    authorize: (input, options) => authorize(oauth.client, input, { ...options, log }),
    pdsHost: cfg.PDS_HOSTNAME,
    handleDomain: cfg.HANDLE_SUFFIX.slice(1),
    allowHttp: cfg.OAUTH_ALLOW_HTTP,
    log,
  });
  const callback = oauthCallbackRoutes({
    complete: (query) => completeAuthorization(oauth.client, query, log),
    consumeNonce: (nonce, deadline) =>
      withClient(oauth.pool, deadline, (db) => nonces.consume(db, "login.nonce", nonce)),
    createSession: (did, replacingCookie, deadline) =>
      withTransaction(oauth.pool, deadline, (tx) =>
        sessions.create(tx, did, replacingCookie === null ? {} : { replacingCookie }),
      ),
    sessionMaxAgeS: cfg.SESSION_ABSOLUTE_S,
    log,
  });
  // Our PDS's issuer origin, and the issuer the OAuth library recorded for a DID at sign-in (its stored token set,
  // read without a refresh). Never a DID-document field (book P2.08 `PdsAccountLink`).
  const pdsIssuer = `${cfg.OAUTH_ALLOW_HTTP ? "http" : "https"}://${cfg.PDS_HOSTNAME}`;
  const issuerOf = async (did: Did): Promise<string | null> => {
    const saved = await oauth.sessionStore.get(did);
    const iss = saved?.tokenSet.iss;
    return typeof iss === "string" ? iss : null;
  };
  const logout = logoutRoutes({
    readSession: async (request, deadline) => (await readSession(request, deadline)).session,
    ...browserLogout({
      pool: oauth.pool,
      sessions,
      limits: sessionLimits,
      // @atproto/oauth-client 0.8.9 OAuthClient.revoke: calls the revocation endpoint, then deletes the stored set.
      revoke: (did) => oauth.client.revoke(did),
    }),
    issuerOf,
    page,
    screens: render.screens,
    pdsIssuer,
    log,
  });
  const pds = createPdsCall({
    client: oauth.client,
    endSessions: (did) =>
      withTransaction(oauth.pool, null, (tx) => sessions.destroyAllForDid(tx, did, "auth_dead")).then(() => undefined),
    tokenSetRemains: (did) =>
      withClient(oauth.pool, null, async (db) => {
        const found = await db.query("SELECT 1 FROM app.oauth_session WHERE did = $1", [did]);
        return found.rowCount === 1;
      }),
    log,
  });
  const accounts = createAccountStore(oauth.pool);
  const versions = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION };
  const emailCache = async (session: Session, deadline: AbortSignal): Promise<EmailCache> => {
    const { rows } = await withClient(oauth.pool, deadline, (db) =>
      db.query<{ email_confirmed: boolean | null; email_checked_at: Date | null }>(
        "SELECT email_confirmed, email_checked_at FROM app.session WHERE id_hash = $1 AND did = $2",
        [session.idHash, session.did],
      ),
    );
    const row = rows[0];
    return row === undefined
      ? { confirmed: null, checkedAt: null }
      : { confirmed: row.email_confirmed, checkedAt: row.email_checked_at };
  };
  const sessionInfo = (did: Did, deadline: AbortSignal) =>
    pds.pdsSessionInfo({ memo: new Map(), deadline, deadlineAt: Date.now() + 10_000 }, did);
  const setEmailConfirmed = (idHash: Buffer, value: boolean, deadline: AbortSignal) =>
    withTransaction(oauth.pool, deadline, (tx) => sessions.setEmailConfirmed(tx, idHash, value));
  const refreshEmail = emailRefresh({ sessionInfo, setEmailConfirmed });
  const gate: AppGate = {
    readSession,
    loadAccount: (did, deadline) => accounts.get(did, deadline),
    versions,
    emailCache,
    refreshEmail,
    now: () => Date.now(),
    emailRecheckS: cfg.EMAIL_RECHECK_S,
  };
  const verifyEmail = verifyEmailRoutes({
    readSession: async (request, deadline) => (await readSession(request, deadline)).session,
    loadAccount: (did, deadline) => accounts.get(did, deadline),
    versions,
    setEmailConfirmed,
    sessionInfo,
    issueNonce: (deadline) =>
      withClient(oauth.pool, deadline, (db) => nonces.issue(db, "login.nonce", { ttlS: PURPOSES["login.nonce"] })),
    authorize: (input, options) => authorize(oauth.client, input, { ...options, log }),
    safeHref: render.safeHref,
    allowHttp: cfg.OAUTH_ALLOW_HTTP,
    page,
    screens: render.screens,
    pdsHost: cfg.PDS_HOSTNAME,
    log,
  });
  const welcome = welcomeRoutes({
    readSession,
    accounts,
    versions,
    minAge: cfg.MIN_AGE,
    countryRule: cfg.INVITE_COUNTRY_RULE === "on",
    supportEmail: cfg.SUPPORT_EMAIL,
    pdsIssuer,
    issuerOf,
    revoke: (did) => oauth.client.revoke(did),
    endSessions: (did, deadline) =>
      withTransaction(oauth.pool, deadline, (tx) => sessions.destroyAllForDid(tx, did, "underage")).then(
        () => undefined,
      ),
    now: () => new Date(),
    safeHref: render.safeHref,
    page,
    screens: render.screens,
    log,
  });
  const settings = settingsRoutes({ gate, page, screens: render.screens });
  const me = meRoutes({
    open: (request, deadline, next) => openApp(gate, request, deadline, next),
    verifyHandle: (did, signal) => handles.verifyHandle(did, { signal }),
    page,
    screens: render.screens,
    issuerOf,
    pdsIssuer,
    log,
  });
  const errorPage = errorPageHook(deps, render.screens);
  const testPages = testRoutes ? testRoutes({ page, screens: render.screens, errorPage }) : [];
  const routes = [
    ...homeRoutes({ page, screens: render.screens }),
    ...legalRoutes({
      page,
      screens: render.screens,
      values: {
        privacyOfficerTitle: cfg.PRIVACY_OFFICER_TITLE,
        privacyOfficerContact: cfg.PRIVACY_OFFICER_CONTACT,
        supportEmail: cfg.SUPPORT_EMAIL,
        pdsHost: cfg.PDS_HOSTNAME,
      },
    }),
    ...securityTxtRoutes({
      origin: cfg.PUBLIC_ORIGIN,
      contact: cfg.SECURITY_CONTACT,
      expires: cfg.SECURITY_TXT_EXPIRES,
    }),
    ...prefsRoutes(),
    ...assetsRoutes(build.files),
    ...oauthMetadataRoutes(cfg.PUBLIC_ORIGIN, cfg.OAUTH_CLIENT_KEYS),
    ...login,
    ...callback,
    ...logout,
    ...welcome,
    ...verifyEmail,
    ...settings,
    ...testPages,
    // The DID parameter route must follow every explicit app/public route.
    ...me,
  ];
  return {
    server: createServer({
      config: cfg,
      routes,
      policies,
      log,
      onClose: oauth.onClose,
      errorPage,
    }),
    page,
    oauth: oauth.client,
    boot: oauth.boot,
  };
}
