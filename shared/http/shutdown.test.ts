// Shutdown against a real socket in a child process (P1.04k): a signal drains in-flight requests, refuses new
// connections, and exits 0, or exits 1 when the grace period ends first.
import { type ChildProcess, spawn } from "node:child_process";
import { connect, createServer as createNetServer } from "node:net";
import { describe, expect, test } from "vitest";

const SHUTDOWN = new URL("./shutdown.ts", import.meta.url).href;

/** A port nothing listens on, so the child's public origin can name it (the host check strips only that port). */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createNetServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });

/** A child process serving `/slow` (300 ms) and `/never`; resolves with the port it printed once listening. */
async function serve(
  graceMs: number,
): Promise<{ child: ChildProcess; port: Promise<number>; exit: Promise<number | null> }> {
  const free = await freePort();
  // The child wires drain and exitOnSignals around a plain node:http server, as interfaces/web/server.ts does (the
  // Hono server that used to stand here went with P1.20k).
  const code = `
    import { createServer } from "node:http";
    import { drain, exitOnSignals } from ${JSON.stringify(SHUTDOWN)};
    let inFlight = 0;
    const server = createServer((request, response) => {
      inFlight += 1;
      response.once("close", () => { inFlight -= 1; });
      if (request.url === "/slow") setTimeout(() => response.end("done"), 300);
    });
    exitOnSignals(() => drain(server, { graceMs: ${graceMs}, inFlight: () => inFlight, hooks: [] }), (c) => process.exit(c));
    server.listen(${free}, "127.0.0.1", () => process.stdout.write(${free} + "\\n"));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  const port = new Promise<number>((resolve, reject) => {
    child.stdout?.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
    child.once("exit", () => reject(new Error("server exited before listening")));
  });
  const exit = new Promise<number | null>((resolve) => child.once("exit", (status) => resolve(status)));
  return { child, port, exit };
}

const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("shutdown", () => {
  test("graceful_shutdown", async () => {
    const { child, port, exit } = await serve(2000);
    const p = await port;
    const slow = fetch(`http://127.0.0.1:${p}/slow`, { headers: { connection: "close" } });
    await sleep(50);
    child.kill("SIGTERM");
    await sleep(50);
    expect(await refused(p)).toBe(true);
    const response = await slow;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("done");
    expect(await exit).toBe(0);
  });

  test("shutdown_deadline", async () => {
    const { child, port, exit } = await serve(200);
    const p = await port;
    fetch(`http://127.0.0.1:${p}/never`).catch(() => undefined);
    await sleep(50);
    const started = performance.now();
    child.kill("SIGTERM");
    expect(await exit).toBe(1);
    const took = performance.now() - started;
    expect(took).toBeGreaterThanOrEqual(150);
    expect(took).toBeLessThan(1500);
  });

  test("second_signal_exits_1", async () => {
    const { child, port, exit } = await serve(5000);
    const p = await port;
    fetch(`http://127.0.0.1:${p}/never`).catch(() => undefined);
    await sleep(50);
    child.kill("SIGTERM");
    await sleep(50);
    child.kill("SIGTERM");
    expect(await exit).toBe(1);
  });
});
