// pds-admin's composition root (P2.09; ADR 0060; rule AB-2): the one place its parts are built. It refuses a PDS URL
// that resolves to a public address (step 13; pds.ts also checks every later lookup) and an admin password the PDS
// refuses (P2.09e), opens the state files and returns the request handler.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress types only, inbound handler
import { join } from "node:path";
import { openJtiStore, resolvesInternal } from "@unset/shared-admin-envelope";
import { BootError, type Config } from "./config.ts";
import { openRequestLog, type RequestLog } from "./log.ts";
import { createPds, type Pds, probePassword, watchPassword } from "./pds.ts";
import { createHandler } from "./server.ts";

export type Composed = {
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
  readonly compactDaily: () => void;
};

/** Names the secret, never its value: the PDS's copy and ours differ, which only the runbook's rotation can fix. */
const WRONG_PASSWORD = "secret pds_admin_password is not the PDS's admin password";

/** Waits between probes while the PDS gives no answer: 1 s, doubling, at most a minute. */
const PROBE_FIRST_MS = 1_000;
const PROBE_MAX_MS = 60_000;

/** Stops the process with one line naming why; the restart policy and the runbook's crash-loop alert take over. */
function halt(why: string): never {
  process.stderr.write(`pds-admin: ${why}; stopping\n`);
  process.exit(1);
}

/** A refused password: one log line, so the request log shows why issuing ended, then the stop. */
function refusedPassword(log: RequestLog): never {
  try {
    log.append({ outcome: "error", reason: "admin_password_refused" }, Date.now());
  } catch {
    // The stop is what matters; a log that cannot take the line must not keep the process up.
  }
  halt(WRONG_PASSWORD);
}

/**
 * Probes until the PDS answers once (P2.09e): it accepts the password, and `accepted` opens issuing, or refuses it,
 * and the service stops. Until then nothing is issued, so a wrong password never meets a member's request.
 */
function probeUntilAnswered(pds: Pds, log: RequestLog, accepted: () => void): void {
  const attempt = async (wait: number): Promise<void> => {
    const answer = await probePassword(pds);
    if (answer === "accepted") return accepted();
    if (answer === "refused") refusedPassword(log);
    setTimeout(() => run(Math.min(wait * 2, PROBE_MAX_MS)), wait).unref();
  };
  // probePassword turns every PDS failure into "unknown"; anything else it throws is a fault here, so stop.
  const run = (wait: number): void => {
    attempt(wait).catch(() => halt("the password probe failed"));
  };
  run(PROBE_FIRST_MS);
}

export async function compose(config: Config): Promise<Composed> {
  if ((await resolvesInternal(config.pdsUrl)) === "public") {
    throw new BootError("PDS_INTERNAL_URL resolves to a public address");
  }
  const client = createPds(config.pdsUrl, config.password);
  const first = await probePassword(client);
  if (first === "refused") throw new BootError(WRONG_PASSWORD);
  const now = () => Date.now();
  const jti = openJtiStore(join(config.stateDir, "jti.log"), Math.floor(now() / 1000));
  const log = openRequestLog(join(config.stateDir, "log.jsonl"), config.logKey);
  let ready = first === "accepted";
  if (!ready) probeUntilAnswered(client, log, () => (ready = true));
  const handler = createHandler({
    keys: config.keys,
    expected: { env: config.env, pdsDid: config.pdsDid },
    limits: {
      signupsOpen: config.signupsOpen,
      windowMs: config.windowHours * 3_600_000,
      maxPerWindow: config.maxPerWindow,
      maxPerDayGlobal: config.maxPerDayGlobal,
    },
    pds: watchPassword(client, () => refusedPassword(log)),
    jti,
    log,
    commit: config.commit,
    now,
    stop: () => halt("a state file is in an unknown state"),
    ready: () => ready,
  });
  return { handler, compactDaily: () => jti.compact(Math.floor(now() / 1000)) };
}
