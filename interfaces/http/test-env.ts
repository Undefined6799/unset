// The web server's environment for tests that compose it (P2.04c). Since the server builds the OAuth client, its config
// needs Postgres as `web`, the seal keyring and the client keys; each secret is written to its own file in `dir`, read
// through its `_FILE` key as in production, and made per run, so no key material sits in the repository. The caller
// makes `dir` (a fresh temporary folder) and removes it when its tests end. Imported only by tests.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRIVACY_OFFICER_CONTACT_TOKEN,
  PRIVACY_OFFICER_TITLE_TOKEN,
  SECURITY_CONTACT_PAGE,
  SECURITY_TXT_EXPIRES,
  SUPPORT_EMAIL_TOKEN,
} from "./legal-placeholders.ts";

/** One private ES256 client key, as OAUTH_CLIENT_KEYS holds it. */
export const clientKeyJwk = (kid: string) => ({
  ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
  kid,
  alg: "ES256",
});

/** The keys the OAuth client adds to the web server's config, with its secrets written into `dir`. */
export function webSecretEnv(dir: string): Record<string, string> {
  const secret = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const keyring = { active: "k1", keys: { k1: randomBytes(32).toString("base64") } };
  return {
    PG_HOST: "postgres",
    PG_DATABASE: "unset",
    PG_USER: "web",
    PG_PASSWORD_FILE: secret("pg_web_password", randomBytes(24).toString("base64url")),
    PG_SSLMODE: "disable",
    PG_POOL_MAX: "4",
    SEAL_KEYRING_FILE: secret("seal_keyring", JSON.stringify(keyring)),
    PLC_URL: "https://plc.directory",
    OAUTH_CLIENT_KEYS_FILE: secret("oauth_client_keys", JSON.stringify([clientKeyJwk("A")])),
    OAUTH_ACTIVE_KID: "A",
    PDS_HOSTNAME: "pds.unset.test",
    HANDLE_SUFFIX: ".pds.unset.test",
  };
}

/** The legal placeholders (P2.15). Spread before a caller's `extra`, so a test can replace a token. */
export function legalTestEnv(): Record<string, string> {
  return {
    PRIVACY_OFFICER_TITLE: PRIVACY_OFFICER_TITLE_TOKEN,
    PRIVACY_OFFICER_CONTACT: PRIVACY_OFFICER_CONTACT_TOKEN,
    SUPPORT_EMAIL: SUPPORT_EMAIL_TOKEN,
    SECURITY_CONTACT: SECURITY_CONTACT_PAGE,
    SECURITY_TXT_EXPIRES,
  };
}

/** The whole env a test passes to `loadConfig(config, …)`; `extra` adds or replaces keys (WEB_BUILD_DIR, mostly). */
export function webTestEnv(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    UNSET_ENV: "test",
    UNSET_SERVICE: "http",
    UNSET_COMMIT: "c".repeat(40),
    LISTEN_PORT: "8080",
    PUBLIC_ORIGIN: "https://unset.test",
    HTTP_ALLOWED_HOSTS: "unset.test",
    MEDIA_ORIGIN: "https://unset-media.test",
    TRUSTED_PROXY_MODE: "header",
    TRUSTED_PROXY_HEADER: "x-forwarded-for",
    TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
    ...legalTestEnv(),
    ...webSecretEnv(dir),
    ...extra,
  };
}
