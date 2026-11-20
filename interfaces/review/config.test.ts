// The review process boots only with bounded work settings (ADR 0070 point 2.2), and needs no secret to boot.
import { loadConfig } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { schema } from "./config.ts";

const env = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "review",
  UNSET_COMMIT: "a".repeat(40),
  LISTEN_PORT: "8082",
};

describe("review config", () => {
  test("boots from the common keys alone, with the defaults", () => {
    const config = loadConfig(schema, env);
    expect([config.REVIEW_CHILDREN, config.REVIEW_QUEUE, config.REVIEW_TIMEOUT_MS]).toEqual([2, 2, 20_000]);
    expect(config.REVIEW_ADDRESS_SPACE_MB).toBe(8192);
  });

  test("refuses a pool or a deadline past its bounds", () => {
    expect(() => loadConfig(schema, { ...env, REVIEW_CHILDREN: "9" })).toThrow();
    expect(() => loadConfig(schema, { ...env, REVIEW_TIMEOUT_MS: "60000" })).toThrow();
    expect(() => loadConfig(schema, { ...env, REVIEW_ADDRESS_SPACE_MB: "512" })).toThrow();
  });
});
