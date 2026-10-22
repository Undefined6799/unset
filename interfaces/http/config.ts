// The config of the web server (unset.sh) (P1.04): the common keys plus the server kit's, and since P2.04c what the
// OAuth client stands on: Postgres as `web`, the seal keyring, net-guard, the identity lookups and the client keys.
import { oauthFields } from "@unset/infrastructure-pds";
import { lockPoolFields, poolFields, postgresFields } from "@unset/infrastructure-postgres";
import { sealFields } from "@unset/infrastructure-seal";
import {
  bool,
  defineEntrypointConfig,
  HOSTNAME,
  int,
  netGuardFields,
  oneOf,
  str,
  url,
  withRule,
} from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";
import { securityContactAllowed, securityTxtExpiry } from "./security-txt.ts";

/**
 * The browser session timeouts (P2.03x; plan section 5.3 "Lifecycle": idle 7 days, absolute 30 days), in seconds,
 * read by the session store (P2.03) against the database clock. The absolute limit is also the cookie's Max-Age, so
 * it may be shorter than 30 days but never longer. Idle never outlasts absolute, and a session is touched more often
 * than it can go idle.
 */
export const sessionConfig = {
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
 * The identity lookups (P2.01's keys, wired here by P2.04c): the PLC directory every did:plc resolves at, the network
 * timeouts, and the DID document cache. PLC_URL must be https on a host net-guard's `plc` policy allows; the identity
 * network refuses anything else at boot (infrastructure/pds/identity-network.ts).
 */
export const identityConfig = {
  PLC_URL: url({ protocols: ["https:"] }),
  IDENTITY_HTTP_TIMEOUT_MS: int({ min: 500, max: 10_000, default: 3000 }),
  IDENTITY_DNS_TIMEOUT_MS: int({ min: 500, max: 10_000, default: 2000 }),
  DID_DOC_CACHE_TTL_S: int({ min: 1, max: 3600, default: 300 }),
  DID_DOC_CACHE_MAX: int({ min: 1, max: 100_000, default: 10_000 }),
  /** P2.02's handle check, wired by P2.13: how long a verified and an invalid verdict are kept, and how many. */
  HANDLE_VERIFY_TTL_S: int({ min: 1, max: 3600, default: 600 }),
  HANDLE_INVALID_TTL_S: int({ min: 1, max: 3600, default: 60 }),
  HANDLE_CACHE_MAX: int({ min: 1, max: 100_000, default: 10_000 }),
};

/**
 * Signing in (P2.05). Our PDS is the authorization server the "Sign in with …" button opens; the reference PDS's issuer
 * is its public URL, `https://` and this host. A name typed without a dot is completed with HANDLE_SUFFIX, the PDS's
 * own `PDS_SERVICE_HANDLE_DOMAINS` value (one suffix, leading dot: production `.unset.im`, development
 * `.staging.unset.im`; ADR 0025).
 */
export const loginConfig = {
  PDS_HOSTNAME: str({ pattern: HOSTNAME }),
  HANDLE_SUFFIX: str({ pattern: new RegExp(`\\.(?:${HOSTNAME.source})`) }),
  /**
   * How long a confirmed-email cache is trusted before the PDS is asked again (P2.11). The maximum is 900 (15
   * minutes) because it also bounds the revoked-grant window below.
   * On our own PDS, a revoked grant ends every session of the account at the next successful email recheck
   * (EMAIL_RECHECK_S, at most 900 s) or at the next PDS call, whichever comes first. While the PDS can't be reached,
   * the cached result is kept, and the bound extends until a recheck succeeds. Once P1.36v lands, accounts on other
   * PDSes are refused at sign-in until P1.33p, which must first force a token refresh at each recheck; before P1.36v
   * they can sign in, and this bound does not hold for them (P2.11c).
   */
  EMAIL_RECHECK_S: int({ min: 60, max: 900, default: 900 }),
  /** Full years before an account may continue (P2.12; plan §6). Never below 16. */
  MIN_AGE: int({ min: 16, max: 120, default: 16 }),
  /** When on, the terms screen requires the invite-country checkbox (P2.12; plan §6). */
  INVITE_COUNTRY_RULE: oneOf(["on", "off"], { default: "on" }),
};

/** Text that can be shown on a page: no C0 controls, no DEL, at most 200 characters. Not an email or a name. */
const PUBLIC_TEXT = new RegExp(
  `[^${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]{1,200}`,
);

/**
 * The legal pages (P2.15). The three text keys are required and have no default: until Alex sets them they hold the
 * placeholder tokens in legal-placeholders.ts. security.txt Contact is `privacy-page` (this origin's privacy notice),
 * a mailto, or an https URI on PUBLIC_ORIGIN with no userinfo (RFC 9116 §2.5.3). Expires must be a future RFC 3339
 * instant at most 365 days ahead; inside 30 days the process still boots and the renewal test fails.
 */
export const legalConfig = {
  PRIVACY_OFFICER_TITLE: str({ pattern: PUBLIC_TEXT }),
  PRIVACY_OFFICER_CONTACT: str({ pattern: PUBLIC_TEXT }),
  SUPPORT_EMAIL: str({ pattern: PUBLIC_TEXT }),
  SECURITY_CONTACT: withRule(str({ pattern: /(?:privacy-page|mailto:\S+|https:\/\/\S+)/ }), (config) => {
    const contact = config.SECURITY_CONTACT;
    const origin = config.PUBLIC_ORIGIN;
    return typeof contact === "string" && typeof origin === "string" && securityContactAllowed(contact, origin);
  }),
  SECURITY_TXT_EXPIRES: withRule(str({ pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/ }), (config) => {
    const expires = config.SECURITY_TXT_EXPIRES;
    if (typeof expires !== "string") return false;
    const state = securityTxtExpiry(expires, Date.now());
    return state === "ok" || state === "soon";
  }),
};

/**
 * The test-only pages (P1.25c, routes/test-routes.ts). Off by default, and a positive allowlist: only `test` may turn
 * them on. Every other profile, dev (staging, ADR 0025) and prod included, refuses the key at start (`config.invalid`
 * with key TEST_ROUTES, exit 78), so no deployed routing holds them. UNSET_ENV has no `local` value; the local stack
 * runs as dev, so it refuses too.
 */
export const testRoutesConfig = {
  TEST_ROUTES: withRule(
    bool({ default: false }),
    (config) => config.TEST_ROUTES !== true || config.UNSET_ENV === "test",
  ),
};

/** Our PDS's issuer, from PDS_HOSTNAME: the only server whose accounts sign in (P1.36v), with no switch to widen it. */
export const pdsIssuerOf = (cfg: { PDS_HOSTNAME: string; OAUTH_ALLOW_HTTP: boolean }): string =>
  `${cfg.OAUTH_ALLOW_HTTP ? "http" : "https"}://${cfg.PDS_HOSTNAME}`;

export const config = defineEntrypointConfig({
  ...httpKitConfig,
  ...sessionConfig,
  ...postgresFields,
  ...poolFields,
  ...lockPoolFields,
  ...sealFields,
  ...netGuardFields,
  ...identityConfig,
  ...oauthFields,
  ...loginConfig,
  ...legalConfig,
  ...testRoutesConfig,
  /** apps/web's browser build, the directory holding `.vite/manifest.json` (P1.23). Empty means apps/web/dist/client. */
  WEB_BUILD_DIR: str({ default: "" }),
});
