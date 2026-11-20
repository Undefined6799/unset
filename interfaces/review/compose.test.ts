// The composition root hands the pool's events to the caller, so main.ts can log a pool that cannot start.
import { loadConfig } from "@unset/shared-config";
import { expect, test } from "vitest";
import { compose } from "./compose.ts";
import { schema } from "./config.ts";

const env = { UNSET_ENV: "test", UNSET_SERVICE: "review", UNSET_COMMIT: "a".repeat(40), LISTEN_PORT: "8082" };

test("compose.pool_events: a child that loads reports ready to the caller", async () => {
  const config = loadConfig(schema, { ...env, REVIEW_CHILDREN: "1" });
  let ready: () => void = () => undefined;
  const happened = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const review = compose(
    config,
    () => undefined,
    (event) => event === "ready" && ready(),
  );
  try {
    await happened;
  } finally {
    review.close();
  }
}, 20_000);
