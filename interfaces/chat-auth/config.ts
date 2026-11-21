// The unset.cc door's settings (build step 6; ADR 0081 decision 4; ADR 0025: unset.cc, staging.unset.cc for staging),
// read once at boot through shared/config, exit 78 when invalid. The kit's keys without MEDIA_ORIGIN, which only pages
// that show pictures need; web's origin, where the hop signs its ticket; its own Postgres role (migration 0038), the
// seal keyring for the lock keys, net-guard, chat-admin with the door's own key, which may only end sessions, and the
// internal count port (ADR 0090).
import { poolFields, postgresFields } from "@unset/infrastructure-postgres";
import { sealFields } from "@unset/infrastructure-seal";
import {
  defineEntrypointConfig,
  HOSTNAME,
  int,
  MATRIX_SERVER_NAME,
  netGuardFields,
  origin,
  secretFile,
  str,
  withRule,
} from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";

const { MEDIA_ORIGIN: _media, ...kit } = httpKitConfig;

export const schema = defineEntrypointConfig({
  ...kit,
  ...postgresFields,
  ...poolFields,
  ...sealFields,
  ...netGuardFields,
  /** unset.sh's origin: GET /chat/sign-in signs the ticket there (interfaces/web). Another origin than the door's. */
  WEB_ORIGIN: withRule(origin({ protocols: ["https:"] }), (config) => config.WEB_ORIGIN !== config.PUBLIC_ORIGIN),
  /** chat-admin's internal origin, and the door's Ed25519 private key (PKCS#8 PEM) with its id in chat-admin's file. */
  CHAT_ADMIN_URL: origin({ protocols: ["http:"] }),
  CHAT_ADMIN_DOOR_KEY: secretFile({ minBytes: 64 }),
  CHAT_ADMIN_DOOR_KID: str({ pattern: /[A-Za-z0-9._-]{1,64}/ }),
  /** The homeserver's name in chat IDs (ADR 0086: staging.unset.cc under dev); prod must use the permanent one. */
  CHAT_SERVER_NAME: withRule(
    str({ pattern: HOSTNAME }),
    (config) => config.UNSET_ENV !== "prod" || config.CHAT_SERVER_NAME === MATRIX_SERVER_NAME,
  ),
  /** The count port (ADR 0090 decision 2): its own listener, never the public one, on the network Synapse and web share. */
  COUNT_LISTEN_PORT: withRule(
    int({ min: 1024, max: 65535 }),
    (config) => config.COUNT_LISTEN_PORT !== config.LISTEN_PORT,
  ),
  /** That listener's origin as Synapse reaches it: the pusher's notify address is this plus the push gateway path. */
  COUNT_ORIGIN: origin({ protocols: ["http:"] }),
});
