// startWeb answers only once its own child answers (#1731 code job, 2026-11-19: a settings test got a 404 in 17 ms).
// startWeb picks a port by binding port 0 and releasing it, so another process on the runner can take that port
// before the web child binds it. The child then exits on EADDRINUSE, and a readiness probe that took any answer as
// "listening" handed the test the other process: every later request went there. A squatter on a pinned port must
// make startWeb fail, never succeed; on a port startWeb picked itself, it picks another and starts there.
import { createServer, type Server } from "node:http"; // guard-allow: egress a loopback squatter for the test only
import { relative } from "node:path";
import { afterAll, expect, inject, test } from "vitest";
import { buildOnce, freePort, startWeb } from "./built-server.ts";

const REPO = new URL("../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };

const squatters: Server[] = [];
afterAll(() => Promise.all(squatters.map((one) => new Promise<void>((done) => one.close(() => done())))));

/** Holds a loopback port with a server that answers every request with a 404, as the other process did. */
function squat(): Promise<number> {
  const squatter = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"status":"not ours"}');
  });
  squatters.push(squatter);
  return new Promise<number>((done) =>
    squatter.listen(0, "127.0.0.1", () => {
      const address = squatter.address();
      done(typeof address === "object" && address !== null ? address.port : 0);
    }),
  );
}

test("a_pinned_port_another_process_holds_fails_the_start", async () => {
  buildOnce(provided.port);
  const port = await squat();
  await expect(startWeb(pg, { LISTEN_PORT: String(port) })).rejects.toThrow(/exited before listening|did not listen/);
}, 60_000);

test("a_picked_port_another_process_takes_is_replaced_by_a_new_one", async () => {
  buildOnce(provided.port);
  const taken = await squat();
  let picks = 0;
  const pickPort = async () => {
    picks += 1;
    return picks === 1 ? taken : freePort();
  };
  const web = await startWeb(pg, {}, undefined, { pickPort });
  try {
    expect(picks).toBe(2);
    expect(web.port).not.toBe(taken);
    expect((await web.fetch("/health")).status).toBe(200);
  } finally {
    await web.stop();
  }
}, 60_000);
