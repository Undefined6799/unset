// P3.08s (handleOnPds.ts): our PDS's own word on which account holds a hosted handle, read through net-guard. Only an
// explicit HandleNotFound is "not found", since that answer clears a handle; anything unclear is "unavailable".
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { afterEach, describe, expect, test } from "vitest";
import { createHandleOnPdsReader } from "./handleOnPds.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const HANDLE = "alice.hosted.test";

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function stubPds(status: number, body: unknown) {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? "");
    response.writeHead(status, { "content-type": "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  const service = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  const read = createHandleOnPdsReader({
    service,
    guard: createNetGuard({ internalHosts: [], allowLoopback: false, commit: "c".repeat(40) }),
    timeoutMs: 2_000,
  });
  return { read: () => read(HANDLE, AbortSignal.timeout(5_000)), asked };
}

describe("handle on our PDS", () => {
  test("handleOnPds.names_the_did", async () => {
    const pds = await stubPds(200, { did: DID });
    expect(await pds.read()).toEqual({ kind: "did", did: DID });
    expect(pds.asked).toEqual([`/xrpc/com.atproto.identity.resolveHandle?handle=${HANDLE}`]);
  });

  test("handleOnPds.only_handle_not_found_is_not_found", async () => {
    expect(await (await stubPds(400, { error: "HandleNotFound" })).read()).toEqual({ kind: "not_found" });
    expect(await (await stubPds(400, { error: "InvalidRequest" })).read()).toEqual({ kind: "unavailable" });
    expect(await (await stubPds(500, { error: "HandleNotFound" })).read()).toEqual({ kind: "unavailable" });
  });

  test("handleOnPds.a_malformed_answer_is_unavailable", async () => {
    for (const body of ["not json", {}, { did: 42 }, { did: "alice" }, { did: "did:plc:a b" }]) {
      expect(await (await stubPds(200, body)).read()).toEqual({ kind: "unavailable" });
    }
  });
});
