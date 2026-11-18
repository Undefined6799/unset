// pds-admin's composition root (P2.09; ADR 0060; rule AB-2): the one place its parts are built. It refuses a PDS URL
// that resolves to a public address (step 13; pds.ts also checks every later lookup), opens the state files and
// returns the request handler.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress types only, inbound handler
import { join } from "node:path";
import { BootError, type Config } from "./config.ts";
import { openJtiStore } from "./jti.ts";
import { openRequestLog } from "./log.ts";
import { createPds, resolvesInternal } from "./pds.ts";
import { createHandler } from "./server.ts";

async function assertInternal(url: URL): Promise<void> {
  if (!(await resolvesInternal(url))) throw new BootError("PDS_INTERNAL_URL resolves to a public address");
}

export type Composed = {
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
  readonly compactDaily: () => void;
};

export async function compose(config: Config): Promise<Composed> {
  await assertInternal(config.pdsUrl);
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
    pds: createPds(config.pdsUrl, config.password),
    jti,
    log: openRequestLog(join(config.stateDir, "log.jsonl"), config.logKey),
    commit: config.commit,
    now,
  });
  return { handler, compactDaily: () => jti.compact(Math.floor(now() / 1000)) };
}
