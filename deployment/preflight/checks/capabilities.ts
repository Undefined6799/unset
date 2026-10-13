// C25 (P1.30x; architecture record 2026-10-12-p129-compose-service-keys, Codex ruling 3 in
// 2026-10-12-batch33-codex-rulings): only the edge image may add a capability. The parser already allows cap_add only
// as [NET_BIND_SERVICE] beside cap_drop [ALL]; which image a service runs is a lock fact, so it is checked here.
// P1.30y: a service with both an image and a build is the edge only when both name it (Amendment 5 of
// 2026-10-12-p204s-p130x-p130y-booked).
// Under --env local (P1.27l) the edge is known only by its build: exactly deployment/edge/Dockerfile, after C26 passes it
// (record 2026-10-13-p127l-local-gaps, Amendment 1).
import { notRunning, runsBuilt } from "./build.ts";
import { lockOrNone } from "./lock.ts";
import { type Check, fail, missing, pass } from "./types.ts";

const EDGE_DOCKERFILE = "deployment/edge/Dockerfile";

export const c25: Check = {
  id: "C25",
  run: (inputs) => {
    const adders = inputs.compose.services.filter((service) => service.hardening.capAdd.length > 0);
    if (adders.length === 0) return pass();
    const lock = lockOrNone(inputs);
    if (lock === null) return missing(inputs.lockPath);
    for (const service of adders) {
      const runs = runsBuilt(service, inputs, lock.edge?.ref, EDGE_DOCKERFILE);
      if (runs === "mismatch")
        return fail(`${service.name} adds a capability but its image and build name different images`);
      if (runs === "no") {
        return fail(`${service.name} adds a capability but ${notRunning(inputs, "edge image", EDGE_DOCKERFILE)}`);
      }
    }
    return pass();
  },
};
