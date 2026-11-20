// The review process's settings (ADR 0070 point 2.2). It holds no secret, no database role and no store key, so
// every value here is a number about how much work it takes on at once.
import { defineEntrypointConfig, int } from "@unset/shared-config";

export const schema = defineEntrypointConfig({
  /** Child processes decoding at once; each holds one picture. */
  REVIEW_CHILDREN: int({ min: 1, max: 8, default: 2 }),
  /** Jobs waiting for a free child; one more answers busy. ADR 0070 point 4 caps the site at four in flight. */
  REVIEW_QUEUE: int({ min: 0, max: 16, default: 2 }),
  /** One job's deadline, after which its child is killed and replaced. Web's own deadline is longer. */
  REVIEW_TIMEOUT_MS: int({ min: 1000, max: 25_000, default: 20_000 }),
  /** Each child's address-space limit; Node needs about 2 GiB of it and a 70-megapixel decode several more. */
  REVIEW_ADDRESS_SPACE_MB: int({ min: 2048, max: 16_384, default: 8192 }),
});
