import { createServer } from "node:http"; // guard-allow: egress test fake, loopback listener only
import type { AddressInfo } from "node:net"; // guard-allow: egress test fake, a type only
import { type Resolve, resolvesInternal } from "@unset/shared-admin-envelope";
import { afterEach, describe, expect, test } from "vitest";
import { createPds, PdsUnavailable } from "../../../interfaces/pds-admin/pds.ts";
import { ALICE, fakePds } from "./harness.ts";

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
  await expect(pds.getAccountInfo("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa")).rejects.toBeInstanceOf(PdsUnavailable);
  expect(Date.now() - started).toBeLessThan(6_000);
  server.close();
}, 12_000);

describe("pds.dns_pinned: every connection's own DNS answers are checked, not only the boot lookup", () => {
  const playDns =
    (addresses: string[]): Resolve =>
    (_host, done) =>
      done(
        null,
        addresses.map((address) => ({ address, family: 4 })),
      );

  test("an internal answer reaches the PDS", async () => {
    const fake = await fakePds();
    const named = new URL(`http://pds.internal.test:${fake.url.port}`);
    const answer = await createPds(named, "pw", playDns(["127.0.0.1"])).getAccountInfo(ALICE);
    await fake.close();
    expect(answer.status).toBe(200);
  });

  test.each([
    ["public", ["93.184.216.34"]],
    ["mixed", ["127.0.0.1", "93.184.216.34"]],
    ["none", []],
  ])("a %s answer after boot is refused and nothing is sent", async (_name, addresses) => {
    const fake = await fakePds();
    // `localhost` reaches the fake through system DNS, so only the vetted per-connection lookup can stop it.
    const named = new URL(`http://localhost:${fake.url.port}`);
    const call = createPds(named, "pw", playDns(addresses)).getAccountInfo(ALICE);
    await expect(call).rejects.toBeInstanceOf(PdsUnavailable);
    await fake.close();
    expect(fake.seen).toEqual([]);
  });

  test("the boot check reads the same rule", async () => {
    expect(await resolvesInternal(new URL("http://pds.internal.test"), playDns(["10.1.2.3"]))).toBe("internal");
    expect(await resolvesInternal(new URL("http://pds.internal.test"), playDns(["10.1.2.3", "8.8.8.8"]))).toBe(
      "public",
    );
    expect(await resolvesInternal(new URL("http://pds.internal.test"), playDns([]))).toBe("unresolved");
    expect(await resolvesInternal(new URL("http://[::1]:2583"))).toBe("internal");
  });
});
