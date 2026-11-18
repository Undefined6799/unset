// pds-admin's composition root (P2.09; ADR 0060; rule AB-2): the one place its parts are built. It refuses a PDS URL
// that resolves to a public address (step 13), opens the state files and returns the request handler.
import { lookup } from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress types only, inbound handler
import { BlockList, isIP } from "node:net"; // guard-allow: egress range matching only, opens no socket
import { join } from "node:path";
import { BootError, type Config } from "./config.ts";
import { openJtiStore } from "./jti.ts";
import { openRequestLog } from "./log.ts";
import { createPds } from "./pds.ts";
import { createHandler } from "./server.ts";

/** Loopback, private, link-local and unique-local ranges: the PDS must answer only from these. */
const INTERNAL = new BlockList();
const V4 = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
] as const;
for (const [net, bits] of V4) INTERNAL.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  INTERNAL.addSubnet(net, bits, "ipv6");

async function assertInternal(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  const internal = ({ address, family }: { address: string; family: number }) =>
    INTERNAL.check(address, family === 6 ? "ipv6" : "ipv4");
  if (answers.length === 0 || !answers.every(internal)) {
    throw new BootError("PDS_INTERNAL_URL resolves to a public address");
  }
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
