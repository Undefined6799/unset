// The unset.cc door's settings (build step 6; ADR 0093 decision 4; ADR 0025: unset.cc, staging.unset.cc for staging),
// read once at boot through shared/config, exit 78 when invalid. The kit's keys without MEDIA_ORIGIN, which only pages
// that show pictures need; web's origin, where the hop signs its ticket; its own Postgres role (migration 0045), the
// seal keyring for the lock keys, net-guard, chat-admin with the door's own key, which may only end sessions, and the
// internal count port (ADR 0101).
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

/** A dotted-quad IPv4 address with no leading zeros. */
const IPV4 = /(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}/;
/**
 * The address a listener binds: the door's own on one network, so a container on its other networks cannot reach it.
 * Never 0.0.0.0, which would bind every network the door joins (Node 26 docs, net.Server.listen `host`).
 */
const listenAddress = () => str({ pattern: IPV4 });

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
  /** The homeserver's name in chat IDs (ADR 0098: staging.unset.cc under dev); prod must use the permanent one. */
  CHAT_SERVER_NAME: withRule(
    str({ pattern: HOSTNAME }),
    (config) => config.UNSET_ENV !== "prod" || config.CHAT_SERVER_NAME === MATRIX_SERVER_NAME,
  ),
  /** The count port (ADR 0101 decision 2): its own listener, never the public one, on the network Synapse and web share. */
  COUNT_LISTEN_PORT: withRule(
    int({ min: 1024, max: 65535 }),
    (config) => config.COUNT_LISTEN_PORT !== config.LISTEN_PORT,
  ),
  /** The public listener's address: the door's own on the network it shares with the edge alone. */
  LISTEN_ADDRESS: withRule(listenAddress(), (config) => config.LISTEN_ADDRESS !== "0.0.0.0"),
  /** The count listener's address: the door's own on the network only Synapse and web share with it (ADR 0101). */
  COUNT_LISTEN_ADDRESS: withRule(
    listenAddress(),
    (config) => config.COUNT_LISTEN_ADDRESS !== "0.0.0.0" && config.COUNT_LISTEN_ADDRESS !== config.LISTEN_ADDRESS,
  ),
  /** That listener's origin as Synapse reaches it: the pusher's notify address is this plus the push gateway path. */
  COUNT_ORIGIN: origin({ protocols: ["http:"] }),
});
