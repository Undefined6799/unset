// chat-admin's composition root (ADR 0081 decision 5; rule AB-2): the one place its parts are built. It refuses a MAS
// or Synapse origin that resolves to a public address (outbound.ts checks every later lookup too) and opens the jti
// file and the room sweep's resume point, both in the state folder.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress types only, inbound handler
import { join } from "node:path";
import { openJtiStore, resolvesInternal } from "@unset/shared-admin-envelope";
import { BootError, type Config } from "./config.ts";
import { createMas } from "./mas.ts";
import { createQuotas } from "./quota.ts";
import { createHandler } from "./server.ts";
import { openSweepCursor } from "./sweep.ts";
import { createSynapse } from "./synapse.ts";

export type Composed = {
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
  readonly compactDaily: () => void;
};

function halt(why: string): never {
  process.stderr.write(`chat-admin: ${why}; stopping\n`);
  process.exit(1);
}

export async function compose(config: Config): Promise<Composed> {
  for (const [name, url] of [
    ["MAS_ADMIN_URL", config.adminUrl],
    ["MAS_TOKEN_URL", config.tokenUrl],
    ["SYNAPSE_ADMIN_URL", config.synapseUrl],
  ] as const) {
    if ((await resolvesInternal(url)) === "public") throw new BootError(`${name} resolves to a public address`);
  }
  const now = () => Date.now();
  const jti = openJtiStore(join(config.stateDir, "jti.log"), Math.floor(now() / 1000));
  const handler = createHandler({
    keys: config.keys,
    env: config.env,
    mas: createMas(config),
    synapse: createSynapse({ adminUrl: config.synapseUrl }),
    sweepCursor: openSweepCursor(join(config.stateDir, "sweep.cursor")),
    sessionTtl: config.sessionTtl,
    jti,
    quotas: createQuotas(),
    log: (line) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`),
    commit: config.commit,
    now,
    stop: () => halt("a state file is in an unknown state"),
  });
  return { handler, compactDaily: () => jti.compact(Math.floor(now() / 1000)) };
}
