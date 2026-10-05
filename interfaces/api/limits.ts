// The public read API's rate-limit policies (P1.06p; plan §5.2, values from the book's P1.06). "N per minute" is
// capacity N refilled at N/60 per second; `default` per IP allows a burst of 60 at 300 per minute.
import { definePolicies } from "@unset/shared-http";

export const policies = definePolicies({
  default: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    { capacity: 3000, refillPerSec: 3000 / 60, scope: "global" },
  ],
  search: [
    { capacity: 60, refillPerSec: 60 / 60, scope: "ip" },
    { capacity: 60, refillPerSec: 60 / 60, scope: "did" },
  ],
});
