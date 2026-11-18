import { createServer } from "node:http"; // guard-allow: egress test fake, loopback listener only
import type { AddressInfo } from "node:net"; // guard-allow: egress test fake, a type only
import { afterEach, expect, test } from "vitest";
import { createPds, PdsUnavailable } from "../../../interfaces/pds-admin/pds.ts";

const timers: NodeJS.Timeout[] = [];
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  // A byte every 500 ms keeps the socket busy, so only a whole-call deadline stops it.
  timers.push(setInterval(() => res.write(" "), 500));
});
afterEach(() => {
  for (const timer of timers.splice(0)) clearInterval(timer);
  server.closeAllConnections();
});

test("pds.deadline: a PDS that dribbles bytes is cut off at 5 s, not left to hold the issuing chain", async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const pds = createPds(new URL(`http://127.0.0.1:${port}`), "unused");
  const started = Date.now();
  await expect(pds.getAccountInfo("did:plc:aliceaaaaaaaaaaaaaaaaaaa")).rejects.toBeInstanceOf(PdsUnavailable);
  expect(Date.now() - started).toBeLessThan(6_000);
  server.close();
}, 12_000);
