// The web process's settings (ADR 0054 decision 3): shared-config like every other process, so the cross-field rules
// and exit 78 hold here too. server.ts loads them with bootOrExit before it imports SvelteKit's handler and shares them
// through the process note (note.ts). A slice adds the fields its routes need, as interfaces/http/config.ts has them.
// P1.20e: what the OAuth client stands on, as interfaces/http/config.ts has it since P2.04c: the lock pool, the seal
// keyring, net-guard, the identity lookups, the client keys and our PDS.
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
  str,
  url,
  withRule,
} from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";
import { legalConfig } from "./legal.ts";

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
  HANDLE_SUFFIX: str({ pattern: new RegExp(`\\.(?:${HOSTNAME.source})`) }),
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
  ...legalConfig,
  ...testRoutesConfig,
});

export type WebConfig = Config<(typeof schema)["fields"]>;
