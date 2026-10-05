// The web server's rate-limit policies (P1.06p; plan §5.2, values from the book's P1.06). Each entry is a token
// bucket: `capacity` requests at once, refilled at `refillPerSec`. "N per minute" is capacity N refilled at N/60 per
// second; `default` per IP allows a burst of 60 at 300 per minute. Per-DID entries apply only on routes that require a
// session. A feature step adds its own policy here, in the same PR as its route.
import { definePolicies } from "@unset/shared-http";

export const policies = definePolicies({
  default: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    { capacity: 3000, refillPerSec: 3000 / 60, scope: "global" },
  ],
  login: [{ capacity: 10, refillPerSec: 10 / 60, scope: "ip" }],
  search: [
    { capacity: 60, refillPerSec: 60 / 60, scope: "ip" },
    { capacity: 60, refillPerSec: 60 / 60, scope: "did" },
  ],
  report: [
    { capacity: 5, refillPerSec: 5 / 60, scope: "ip" },
    { capacity: 10, refillPerSec: 10 / 60, scope: "did" },
  ],
  follow: [{ capacity: 120, refillPerSec: 120 / 60, scope: "did" }],
  like: [{ capacity: 120, refillPerSec: 120 / 60, scope: "did" }],
  // The daily upload cap is a database counter (P4.03), not a bucket.
  upload: [{ capacity: 10, refillPerSec: 10 / 60, scope: "did" }],
});
