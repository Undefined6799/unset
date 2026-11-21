// The door's composition root (build step 6; rule AB-2): the one place its parts are built. Its limits are its own:
// a sign-in hop per client every few seconds, and a looser bucket for the page, its script and health.

import type { Config } from "@unset/shared-config";
import { createClientIpResolver, createRateLimiter, definePolicies } from "@unset/shared-http";
import type { schema } from "./config.ts";
import { createDoor, type DoorLog } from "./door.ts";
import { createListener } from "./listener.ts";

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

export function compose(config: Config<(typeof schema)["fields"]>, logs: Logs) {
  const door = createDoor({
    origin: config.PUBLIC_ORIGIN,
    webOrigin: config.WEB_ORIGIN,
    allowedHosts: config.HTTP_ALLOWED_HOSTS,
    limiter: createRateLimiter(POLICIES, { maxKeys: config.RATE_LIMIT_MAX_KEYS, onError: () => undefined }),
    clientIp: createClientIpResolver(config, logs.untrustedPeer),
    log: logs.request,
    deadlineMs: config.REQUEST_DEADLINE_MS,
    posts: {},
  });
  return createListener(config.PUBLIC_ORIGIN, BODY_CAP, door);
}
