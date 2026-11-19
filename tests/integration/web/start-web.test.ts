// startWeb answers only once its own child answers (#1731 code job, 2026-11-19: a settings test got a 404 in 17 ms).
// startWeb picks a port by binding port 0 and releasing it, so another process on the runner can take that port
// before the web child binds it. The child then exits on EADDRINUSE, and a readiness probe that took any answer as
// "listening" handed the test the other process: every later request went there. A squatter on the port must make
// startWeb fail, never succeed.
import { createServer, type Server } from "node:http"; // guard-allow: egress a loopback squatter for the test only
import { relative } from "node:path";
import { afterAll, expect, inject, test } from "vitest";
import { buildOnce, startWeb } from "./built-server.ts";

const REPO = new URL("../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };

let squatter: Server | undefined;
afterAll(() => new Promise<void>((done) => (squatter ? squatter.close(() => done()) : done())));

test("a_port_another_process_holds_fails_the_start", async () => {
  buildOnce(provided.port);
  squatter = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"status":"not ours"}');
  });
  const port = await new Promise<number>((done) =>
    squatter?.listen(0, "127.0.0.1", () => {
      const address = squatter?.address();
      done(typeof address === "object" && address !== null ? address.port : 0);
    }),
  );
  await expect(startWeb(pg, { LISTEN_PORT: String(port) })).rejects.toThrow(/exited before listening|did not listen/);
}, 60_000);
