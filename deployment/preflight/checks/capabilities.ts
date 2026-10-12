// C25 (P1.30x; architecture record 2026-10-12-p129-compose-service-keys, Codex ruling 3 in
// 2026-10-12-batch33-codex-rulings): only the edge image may add a capability. The parser already allows cap_add only
// as [NET_BIND_SERVICE] beside cap_drop [ALL]; which image a service runs is a lock fact, so it is checked here.
import { readLock } from "./images.ts";
import { type Check, fail, missing, pass } from "./types.ts";

export const c25: Check = {
  id: "C25",
  run: (inputs) => {
    const adders = inputs.compose.services.filter((service) => service.hardening.capAdd.length > 0);
    if (adders.length === 0) return pass();
    const lock = readLock(inputs);
    if (lock === null) return missing(inputs.lockPath);
    const edgeRef = lock.edge?.ref;
    const other = adders.find((service) => typeof edgeRef !== "string" || service.image !== edgeRef);
    return other === undefined
      ? pass()
      : fail(`${other.name} adds a capability but does not run the lock's edge image`);
  },
};
