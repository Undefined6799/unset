// The door's composition root (build step 6; rule AB-2): the one place its parts are built. Its limits are its own:
// a sign-in hop per client every few seconds, and a looser bucket for the chat page, its files, health, Log out and the setup claim. Before
// it answers anything the pool must fit the role's connection limit across replicas, and the door's key must be
// Ed25519, or it does not start.
import { createPrivateKey, randomBytes, randomUUID } from "node:crypto";
import type { DoorPorts, LockKey } from "@unset/domains-messaging";
import { createDoorChatAdminClient } from "@unset/infrastructure-matrix";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import {
  checkConnectionBudget,
  connectionOf,
  createBrowserListStore,
  createPool,
  createSetupClaimStore,
  withClient,
} from "@unset/infrastructure-postgres";
import { createSealer } from "@unset/infrastructure-seal";
import type { Config } from "@unset/shared-config";
import { createClientIpResolver, createRateLimiter, definePolicies } from "@unset/shared-http";
import type { schema } from "./config.ts";
import { createDoor, type DoorLog } from "./door.ts";
import { createListener } from "./listener.ts";
import type { ChatPage } from "./page.ts";
import { redeemRoute, setupClaimRoute, setupReleaseRoute, signOutRoute } from "./routes.ts";

/** The largest body the door reads: a redeem's ticket, about 600 bytes of JSON, with room to spare. */
const BODY_CAP = 4096;

const POLICIES = definePolicies({
  default: [{ capacity: 60, refillPerSec: 1, scope: "ip" }],
  "sign-in": [
    { capacity: 10, refillPerSec: 0.2, scope: "ip" },
    { capacity: 500, refillPerSec: 50, scope: "global" },
  ],
});

export type Logs = { readonly request: (line: DoorLog) => void; readonly untrustedPeer: () => void };
type DoorConfig = Config<(typeof schema)["fields"]>;

function doorKey(pem: string) {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("CHAT_ADMIN_DOOR_KEY is not an Ed25519 private key");
  return key;
}

/** `page` is the chat page main.ts loaded from apps/chat's build (ADR 0088 decision 1). */
export async function compose(config: DoorConfig, logs: Logs, page: ChatPage) {
  const pool = createPool({
    connection: connectionOf(config),
    service: "chat-auth",
    max: config.PG_POOL_MAX,
    connectTimeoutMs: config.PG_CONNECT_TIMEOUT_MS,
  });
  await withClient(pool, null, (db) => checkConnectionBudget(db, [config.PG_POOL_MAX], config.PG_MAX_REPLICAS));
  const guard = createNetGuard({
    internalHosts: config.NETGUARD_INTERNAL_HOSTS,
    allowLoopback: config.NETGUARD_ALLOW_LOOPBACK,
    commit: config.UNSET_COMMIT,
  });
  const chatAdmin = createDoorChatAdminClient(guard, {
    origin: config.CHAT_ADMIN_URL,
    env: config.UNSET_ENV === "prod" ? "prod" : "dev",
    key: { kid: config.CHAT_ADMIN_DOOR_KID, privateKey: doorKey(config.CHAT_ADMIN_DOOR_KEY.reveal()) },
  });
  const ports: DoorPorts = {
    list: createBrowserListStore(pool, createSealer(config.SEAL_KEYRING)),
    mint: chatAdmin.mint,
    end: chatAdmin.end,
    newLockKey: () => new Uint8Array(randomBytes(32)) as LockKey,
    newId: randomUUID,
    nowS: () => Math.floor(Date.now() / 1000),
  };
  const setup = { list: ports.list, claims: createSetupClaimStore(pool) };
  const handle = createDoor({
    origin: config.PUBLIC_ORIGIN,
    webOrigin: config.WEB_ORIGIN,
    allowedHosts: config.HTTP_ALLOWED_HOSTS,
    limiter: createRateLimiter(POLICIES, { maxKeys: config.RATE_LIMIT_MAX_KEYS, onError: () => undefined }),
    clientIp: createClientIpResolver(config, logs.untrustedPeer),
    log: logs.request,
    deadlineMs: config.REQUEST_DEADLINE_MS,
    page,
    posts: {
      "/sign-in/redeem": redeemRoute({ ports, serverName: config.CHAT_SERVER_NAME }),
      "/sign-out": signOutRoute({ ports }),
      "/setup/claim": setupClaimRoute(setup),
      "/setup/release": setupReleaseRoute(setup),
    },
  });
  return { listener: createListener(config.PUBLIC_ORIGIN, BODY_CAP, handle), handle, close: () => pool.end() };
}
