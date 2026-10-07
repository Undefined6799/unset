// C1 and C10 (P1.30): the stack is the env's own project, and only the edge is reachable from outside the host.
import type { Port } from "../compose-parse.ts";
import { type Check, fail, pass } from "./types.ts";

/** C1: `name:` pins the project, so an overlay never lands in another env's project (vault note
 * compose-overlay-must-pin-project-name). */
export const c1: Check = {
  id: "C1",
  run: ({ compose, env }) => (compose.name === `unset-${env}` ? pass() : fail(`name is not unset-${env}`)),
};

const WEB_PORTS = [80, 443];
/** Whether a published host port (a number or a range) includes 80 or 443; an engine-chosen one is ephemeral. */
function couldBeWebPort(published: string | null): boolean {
  if (published === null) return false;
  const [low = 0, high = low] = published.split("-").map(Number);
  return WEB_PORTS.some((p) => p >= low && p <= high);
}
const isWebPort = (port: Port): boolean => port.published === "80" || port.published === "443";

/** C10: the edge alone publishes 80 and 443; every other published port binds 127.0.0.1. */
export const c10: Check = {
  id: "C10",
  run: ({ compose }) => {
    for (const { name, ports } of compose.services) {
      for (const port of ports) {
        if (name === "edge" && isWebPort(port)) continue;
        if (name !== "edge" && couldBeWebPort(port.published)) return fail(`${name} may publish 80 or 443`);
        if (port.hostIp !== "127.0.0.1") return fail(`${name} publishes ${port.target} beyond 127.0.0.1`);
      }
    }
    return pass();
  },
};
