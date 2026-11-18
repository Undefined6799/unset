// P3.06s (repoStatus.ts): our PDS's own word on an account's hosting status, read through net-guard. Only an
// explicit RepoNotFound counts as "not found", since that answer leads towards deletion; anything unclear is
// "unavailable" and changes nothing.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { afterEach, describe, expect, test } from "vitest";
import { createRepoStatusReader } from "./repoStatus.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function stubPds(status: number, body: unknown, type = "application/json") {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? "");
    response.writeHead(status, { "content-type": type });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  const service = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  const read = createRepoStatusReader({
    service,
    guard: createNetGuard({ internalHosts: [], allowLoopback: false, commit: "c".repeat(40) }),
    timeoutMs: 2_000,
  });
  return { read: (did = DID) => read(did, AbortSignal.timeout(5_000)), asked };
}

describe("repo status", () => {
  test("repoStatus.active_account", async () => {
    const pds = await stubPds(200, { did: DID, active: true, rev: "3kaaaaaaaaa22" });
    expect(await pds.read()).toEqual({ kind: "active" });
    expect(pds.asked).toEqual([`/xrpc/com.atproto.sync.getRepoStatus?did=${encodeURIComponent(DID)}`]);
  });

  test("repoStatus.inactive_account_keeps_its_status", async () => {
    expect(await (await stubPds(200, { did: DID, active: false, status: "takendown" })).read()).toEqual({
      kind: "inactive",
      status: "takendown",
    });
    expect(await (await stubPds(200, { did: DID, active: false })).read()).toEqual({ kind: "inactive", status: null });
  });

  test("repoStatus.only_repo_not_found_is_not_found", async () => {
    expect(await (await stubPds(400, { error: "RepoNotFound", message: "gone" })).read()).toEqual({
      kind: "not_found",
    });
    expect(await (await stubPds(400, { error: "InvalidRequest" })).read()).toEqual({ kind: "unavailable" });
    expect(await (await stubPds(404, "no")).read()).toEqual({ kind: "unavailable" });
    expect(await (await stubPds(500, { error: "InternalServerError" })).read()).toEqual({ kind: "unavailable" });
  });

  test("repoStatus.an_answer_for_another_did_or_malformed_is_unavailable", async () => {
    const other = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
    expect(await (await stubPds(200, { did: other, active: true })).read()).toEqual({ kind: "unavailable" });
    expect(await (await stubPds(200, { did: DID, active: "yes" })).read()).toEqual({ kind: "unavailable" });
    expect(await (await stubPds(200, { did: DID, active: false, status: 7 })).read()).toEqual({ kind: "unavailable" });
    expect(await (await stubPds(200, "{not json")).read()).toEqual({ kind: "unavailable" });
    expect(await (await stubPds(200, { did: DID, active: true }, "text/html")).read()).toEqual({ kind: "unavailable" });
  });

  test("repoStatus.unreachable_pds_is_unavailable", async () => {
    const read = createRepoStatusReader({
      service: new URL("http://127.0.0.1:1"),
      guard: createNetGuard({ internalHosts: [], allowLoopback: false, commit: "c".repeat(40) }),
      timeoutMs: 500,
    });
    expect(await read(DID, AbortSignal.timeout(2_000))).toEqual({ kind: "unavailable" });
  });
});
