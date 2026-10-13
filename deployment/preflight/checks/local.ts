// L1 and L2 (P1.27l; architecture record 2026-10-12-p129-local-build-preflight, item 2): the guards that make a stack
// that passes C2 to C5 unsigned a local one. They run only under --env local, after every other check, and either
// failing fails the run: nothing listens beyond loopback, and the PDS is a `.localhost` throwaway with no real accounts
// (RFC 6761, section 6.3: `.localhost` names resolve to loopback only).
import { type Check, fail, pass, serviceNamed } from "./types.ts";

/** L1: every published port binds 127.0.0.1, the edge's 80 and 443 included. */
export const l1: Check = {
  id: "L1",
  run: ({ compose }) => {
    for (const { name, ports } of compose.services) {
      if (ports.some((port) => port.hostIp !== "127.0.0.1")) return fail(`${name} publishes a port beyond loopback`);
    }
    return pass();
  },
};

/** L2: the PDS's own hostname is a `.localhost` name. */
export const l2: Check = {
  id: "L2",
  run: (inputs) => {
    const env = inputs.serviceEnv.get("pds");
    if (serviceNamed(inputs, "pds") === undefined || env === undefined) return fail("no pds service");
    const local = env.use("PDS_HOSTNAME", (value) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost$/.test(value ?? ""));
    return local ? pass() : fail("PDS_HOSTNAME is not a name under the loopback-only top-level domain");
  },
};
