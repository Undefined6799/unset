// pds-admin's composition root (P2.09; ADR 0060; rule AB-2): the one place its parts are built. It refuses a PDS URL
// that resolves to a public address (step 13; pds.ts also checks every later lookup) and an admin password the PDS
// refuses (P2.09e), opens the state files and returns the request handler.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress types only, inbound handler
import { join } from "node:path";
import { BootError, type Config } from "./config.ts";
import { openJtiStore } from "./jti.ts";
import { openRequestLog } from "./log.ts";
import { createPds, passwordRefused, resolvesInternal, watchPassword } from "./pds.ts";
import { createHandler } from "./server.ts";

async function assertInternal(url: URL): Promise<void> {
  if (!(await resolvesInternal(url))) throw new BootError("PDS_INTERNAL_URL resolves to a public address");
}

export type Composed = {
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
  readonly compactDaily: () => void;
};

/** Names the secret, never its value: the PDS's copy and ours differ, which only the runbook's rotation can fix. */
const WRONG_PASSWORD = "secret pds_admin_password is not the PDS's admin password";

/** Stops the process with one line naming why; the restart policy and the runbook's crash-loop alert take over. */
function halt(why: string): never {
  process.stderr.write(`pds-admin: ${why}; stopping\n`);
  process.exit(1);
}

export async function compose(config: Config): Promise<Composed> {
  await assertInternal(config.pdsUrl);
  const client = createPds(config.pdsUrl, config.password);
  if (await passwordRefused(client)) throw new BootError(WRONG_PASSWORD);
  const now = () => Date.now();
  const jti = openJtiStore(join(config.stateDir, "jti.log"), Math.floor(now() / 1000));
  const handler = createHandler({
    keys: config.keys,
    expected: { env: config.env, pdsDid: config.pdsDid },
    limits: {
      signupsOpen: config.signupsOpen,
      windowMs: config.windowHours * 3_600_000,
      maxPerWindow: config.maxPerWindow,
      maxPerDayGlobal: config.maxPerDayGlobal,
    },
    pds: watchPassword(client, () => halt(WRONG_PASSWORD)),
    jti,
    log: openRequestLog(join(config.stateDir, "log.jsonl"), config.logKey),
    commit: config.commit,
    now,
    stop: () => halt("a state file is in an unknown state"),
  });
  return { handler, compactDaily: () => jti.compact(Math.floor(now() / 1000)) };
}
