// The media proxy's rate-limit policies (P1.06p; plan §5.2, values from the book's P1.06): only `default`, per IP a burst
// of 60 at 300 per minute, with a global ceiling of 3000 per minute.
import { definePolicies } from "@unset/shared-http";

export const policies = definePolicies({
  default: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    { capacity: 3000, refillPerSec: 3000 / 60, scope: "global" },
  ],
});
