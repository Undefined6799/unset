// The web process's settings (ADR 0054 decision 3): shared-config like every other process, so the cross-field rules
// and exit 78 hold here too. server.ts loads them with bootOrExit before it imports SvelteKit's handler and shares them
// through the process note (note.ts). A slice adds the fields its routes need, as interfaces/http/config.ts has them.
// P1.20e: what the OAuth client stands on, as interfaces/http/config.ts has it since P2.04c: the lock pool, the seal
// keyring, net-guard, the identity lookups, the client keys and our PDS.
import { parseRequesterEmail } from "@unset/domains-identity";
import { parseSmtpUrl } from "@unset/infrastructure-email";
import { oauthFields } from "@unset/infrastructure-pds";
import { lockPoolFields, poolFields, postgresFields } from "@unset/infrastructure-postgres";
import { sealFields } from "@unset/infrastructure-seal";
import {
  bool,
  type Config,
  defineEntrypointConfig,
  HOSTNAME,
  int,
  netGuardFields,
  oneOf,
  optionalSecretFile,
  origin,
  Secret,
  secretFile,
  str,
  url,
  withRule,
} from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";
import { legalConfig } from "./legal.ts";

const WEB_KEY = /^[0-9a-f]{64}$/;

/** Browser session timeouts (plan section 5.3), as interfaces/http/config.ts defines them. */
const sessionConfig = {
  SESSION_IDLE_S: withRule(
    int({ min: 300, max: 2_592_000, default: 604_800 }),
    (config) => Number(config.SESSION_IDLE_S) <= Number(config.SESSION_ABSOLUTE_S),
  ),
  SESSION_ABSOLUTE_S: int({ min: 300, max: 2_592_000, default: 2_592_000 }),
  SESSION_TOUCH_INTERVAL_S: withRule(
    int({ min: 1, max: 3600, default: 300 }),
    (config) => Number(config.SESSION_TOUCH_INTERVAL_S) < Number(config.SESSION_IDLE_S),
  ),
};

/**
 * The identity lookups (interfaces/http/config.ts `identityConfig`): the PLC directory, the network timeouts, the DID
 * document cache and the handle check's cache. PLC_URL must be https on a host net-guard's `plc` policy allows.
 */
const identityConfig = {
  PLC_URL: url({ protocols: ["https:"] }),
  IDENTITY_HTTP_TIMEOUT_MS: int({ min: 500, max: 10_000, default: 3000 }),
  IDENTITY_DNS_TIMEOUT_MS: int({ min: 500, max: 10_000, default: 2000 }),
  DID_DOC_CACHE_TTL_S: int({ min: 1, max: 3600, default: 300 }),
  DID_DOC_CACHE_MAX: int({ min: 1, max: 100_000, default: 10_000 }),
  HANDLE_VERIFY_TTL_S: int({ min: 1, max: 3600, default: 600 }),
  HANDLE_INVALID_TTL_S: int({ min: 1, max: 3600, default: 60 }),
  HANDLE_CACHE_MAX: int({ min: 1, max: 100_000, default: 10_000 }),
};

/**
 * Our PDS (interfaces/http/config.ts `loginConfig`): its host, the only issuer whose accounts sign in (P1.36v), and the
 * handle suffix a name typed without a dot is completed with (one suffix, leading dot; ADR 0025).
 */
const pdsConfig = {
  PDS_HOSTNAME: str({ pattern: HOSTNAME }),
  // Web's mark on its own calls to our PDS (P1.21j; Proposed ADR 0071): exactly the 64 lower-case hex characters the
  // edge's pds_web_key holds, so a key the edge could never match stops boot instead of failing quietly.
  PDS_WEB_KEY: withRule(
    secretFile({ minBytes: 64 }),
    (config) => config.PDS_WEB_KEY instanceof Secret && WEB_KEY.test(config.PDS_WEB_KEY.reveal()),
  ),
  HANDLE_SUFFIX: str({ pattern: new RegExp(`\\.(?:${HOSTNAME.source})`) }),
};

/** Onboarding and the email gate (interfaces/http/config.ts `loginConfig`, P2.11, P2.12; ranges and reasons there). */
const onboardingConfig = {
  /** How long a confirmed-email cache is trusted before the PDS is asked again; past 4 × it a transient recheck shows
   * the PDS-unavailable page (P2.11d). At most 900, because it also bounds the revoked-grant window. */
  EMAIL_RECHECK_S: int({ min: 60, max: 900, default: 900 }),
  /** Full years before an account may continue (plan §6). Never below 16. */
  MIN_AGE: int({ min: 16, max: 120, default: 16 }),
  /** When on, the terms step requires the invite-country checkbox (plan §6). */
  INVITE_COUNTRY_RULE: oneOf(["on", "off"], { default: "on" }),
};

/**
 * Member invites (book P2.10; ADR 0060): pds-admin's internal origin, the Ed25519 private key web signs each request
 * with (PKCS#8 PEM, the runbook's `web_pds_admin_key`) and its key id in pds-admin's roster, and our PDS's DID, which
 * every request is bound to. pds-admin refuses a request whose PDS DID is not its own.
 */
const inviteConfig = {
  PDS_ADMIN_URL: origin({ protocols: ["http:", "https:"] }),
  PDS_ADMIN_WEB_KEY: secretFile({ minBytes: 64 }),
  PDS_ADMIN_WEB_KID: str({ pattern: /[A-Za-z0-9._-]{1,64}/ }),
  PDS_DID: str({ pattern: /did:(?:plc|web):[A-Za-z0-9._:%-]{1,256}/ }),
};

/**
 * Chat (build step 5; ADR 0093 decisions 3 and 5): chat-admin's internal origin, where web queues each member's chat
 * account, and the Ed25519 private key web signs its envelopes and sign-in tickets with (PKCS#8 PEM, its own key, not
 * the pds-admin one) with its key id in chat-admin's key file, and the door's origin the sign-in hop returns to.
 */
const chatConfig = {
  CHAT_ADMIN_URL: origin({ protocols: ["http:"] }),
  CHAT_ADMIN_WEB_KEY: secretFile({ minBytes: 64 }),
  CHAT_ADMIN_WEB_KID: str({ pattern: /[A-Za-z0-9._-]{1,64}/ }),
  /** The door on unset.cc (ADR 0025: unset.cc, staging.unset.cc for staging), where the sign-in hop sends the ticket. */
  CHAT_DOOR_ORIGIN: origin({ protocols: ["https:"] }),
  /** The door's internal count port (build step 10; ADR 0101 decision 2), where web reads a member's chat count. */
  CHAT_COUNT_URL: origin({ protocols: ["http:"] }),
};

/**
 * Members' pictures in the private object store (ADR 0041 Decision 3, ADR 0070 point 2.4): the store's internal origin,
 * the bucket, and web's identity in it, whose actions reach `drafts/*` and list the bucket, nothing else (runbook "The
 * object store's identities"). The key id is a fixed name, not a secret; the secret is a mounted file.
 */
const objectStoreConfig = {
  OBJECT_STORE_URL: origin({ protocols: ["http:", "https:"] }),
  OBJECT_STORE_BUCKET: str({ pattern: /[a-z0-9][a-z0-9.-]{2,62}/ }),
  OBJECT_STORE_ACCESS_ID: str({ pattern: /[A-Za-z0-9._-]{1,128}/ }),
  OBJECT_STORE_SECRET: secretFile({ minBytes: 32 }),
};

/**
 * The review process (ADR 0070 point 2.2): its one internal origin on `review_web`, where web sends a member's picture
 * through net-guard's `review` policy and gets the versions back. No secret: review holds none and trusts web's network.
 */
const reviewConfig = {
  REVIEW_URL: origin({ protocols: ["http:"] }),
};

/**
 * Search and AI listing for the whole site (P1.21b, within ADR 0062). Off, the default, so a stack that leaves it unset
 * is never listed: every response says noindex, robots.txt refuses AI crawlers and names no member, and the sitemap
 * lists nothing, whatever members chose; their choices are kept. On, each member's own choices decide, as ADR 0062 describes.
 */
const searchConfig = {
  SEARCH_LISTING: oneOf(["on", "off"], { default: "off" }),
};

/** A secret file that is unset, or set and passing `check`. */
const unsetOr = (value: unknown, check: (text: string) => boolean): boolean =>
  value === undefined || (value instanceof Secret && check(value.reveal()));

/**
 * Invite requests (book P2.10r; ADR 0080): off by default, so a stack with no mail settings never offers the form. On,
 * the three below must be set: the SMTP server as an `smtps:` URL (it holds the provider's key), the owner's address
 * the notice goes to (a file, so it is never in the checkout or in `docker inspect`), and the sender address.
 */
const inviteRequestConfig = {
  INVITE_REQUESTS: withRule(
    oneOf(["on", "off"], { default: "off" }),
    (config) =>
      config.INVITE_REQUESTS !== "on" ||
      (config.INVITE_REQUEST_SMTP_URL instanceof Secret &&
        config.INVITE_REQUEST_TO instanceof Secret &&
        parseRequesterEmail(String(config.INVITE_REQUEST_FROM)) !== null),
  ),
  INVITE_REQUEST_SMTP_URL: withRule(optionalSecretFile({ minBytes: 16 }), (config) =>
    unsetOr(config.INVITE_REQUEST_SMTP_URL, (text) => parseSmtpUrl(text) !== null),
  ),
  INVITE_REQUEST_TO: withRule(optionalSecretFile({ minBytes: 6 }), (config) =>
    unsetOr(config.INVITE_REQUEST_TO, (text) => parseRequesterEmail(text) !== null),
  ),
  INVITE_REQUEST_FROM: str({ default: "" }),
};

/** Our PDS's issuer, from PDS_HOSTNAME, with no switch to widen it (interfaces/http/config.ts `pdsIssuerOf`). */
export const pdsIssuerOf = (cfg: { PDS_HOSTNAME: string; OAUTH_ALLOW_HTTP: boolean }): string =>
  `${cfg.OAUTH_ALLOW_HTTP ? "http" : "https"}://${cfg.PDS_HOSTNAME}`;

/** The test-only routes under /test-routes/ (P1.25c): only `test` may turn them on; every other profile refuses. */
const testRoutesConfig = {
  TEST_ROUTES: withRule(
    bool({ default: false }),
    (config) => config.TEST_ROUTES !== true || config.UNSET_ENV === "test",
  ),
};

export const schema = defineEntrypointConfig({
  ...httpKitConfig,
  ...sessionConfig,
  ...postgresFields,
  ...poolFields,
  ...lockPoolFields,
  ...sealFields,
  ...netGuardFields,
  ...identityConfig,
  ...oauthFields,
  ...pdsConfig,
  ...onboardingConfig,
  ...inviteConfig,
  ...inviteRequestConfig,
  ...chatConfig,
  ...objectStoreConfig,
  ...reviewConfig,
  ...searchConfig,
  ...legalConfig,
  ...testRoutesConfig,
});

export type WebConfig = Config<(typeof schema)["fields"]>;
