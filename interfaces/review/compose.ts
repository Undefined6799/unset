// The review process's composition root (ADR 0070 point 2.2): the child pool and the door in front of it, from the
// settings. Nothing else is built here: review holds no secret, no database pool and no outbound client.
import { type Counted, createImagePool, type PoolEvent, reviewListener } from "@unset/infrastructure-image";
import type { Config } from "@unset/shared-config";
import type { schema } from "./config.ts";

export function compose(
  config: Config<(typeof schema)["fields"]>,
  counted: Counted,
  onPoolEvent: (event: PoolEvent) => void,
) {
  const pool = createImagePool({
    children: config.REVIEW_CHILDREN,
    queueMax: config.REVIEW_QUEUE,
    timeoutMs: config.REVIEW_TIMEOUT_MS,
    addressSpaceMb: config.REVIEW_ADDRESS_SPACE_MB,
    onEvent: onPoolEvent,
  });
  return { listener: reviewListener(pool, counted), close: () => pool.close() };
}
