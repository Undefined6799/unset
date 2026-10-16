// The config of the web server (unset.sh) (P1.04): the common keys plus the server kit's, and since P2.04c what the
// OAuth client stands on: Postgres as `web`, the seal keyring, net-guard, the identity lookups and the client keys.
import { oauthFields } from "@unset/infrastructure-pds";
import { lockPoolFields, poolFields, postgresFields } from "@unset/infrastructure-postgres";
import { sealFields } from "@unset/infrastructure-seal";
import { defineEntrypointConfig, HOSTNAME, int, netGuardFields, str, url, withRule } from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";

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
 * Signing in (P2.05). Our PDS is the authorization server the "Use … sign-in" button opens; the reference PDS's issuer
 * is its public URL, `https://` and this host. A name typed without a dot is completed with HANDLE_SUFFIX, the PDS's
 * own `PDS_SERVICE_HANDLE_DOMAINS` value (one suffix, leading dot: `.0x40.me`, dev `.0x40.space`).
 */
export const loginConfig = {
  PDS_HOSTNAME: str({ pattern: HOSTNAME }),
  HANDLE_SUFFIX: str({ pattern: new RegExp(`\\.(?:${HOSTNAME.source})`) }),
  /** How long a confirmed-email cache is trusted before the PDS is asked again (P2.11). */
  EMAIL_RECHECK_S: int({ min: 60, max: 86_400, default: 900 }),
};

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
  /** apps/web's browser build, the directory holding `.vite/manifest.json` (P1.23). Empty means apps/web/dist/client. */
  WEB_BUILD_DIR: str({ default: "" }),
});
