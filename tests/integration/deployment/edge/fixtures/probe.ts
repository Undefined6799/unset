// A client inside the edge container's network namespace (P1.28 tests), so it can send from a chosen loopback
// address (127.0.0.2, 127.0.0.3, …): each address is its own rate-limit key, and the log tests know exactly which
// address to look for. Run by edge-container.ts in the pinned node image as `node probe.ts '<steps JSON>'`, with the
// edge's internal CA root in $CA. Node built-ins only; it prints one JSON result per step.
import { request as httpRequest } from "node:http"; // guard-allow: egress local edge test only
import { Agent, request as httpsRequest } from "node:https"; // guard-allow: egress local edge test only
import { connect } from "node:net"; // guard-allow: egress local edge test only

type Step =
  | { kind: "https"; path: string; method?: string; count?: number; headers?: Record<string, string> }
  | { kind: "http"; port: number; path: string }
  | { kind: "garbage" };
type Result = { statuses: number[]; retryAfter?: string };

const [source, stepsJson] = process.argv.slice(2);
const steps = JSON.parse(stepsJson ?? "[]") as Step[];
const agent = new Agent({ keepAlive: true, maxSockets: 1, localAddress: source, ca: process.env.CA });

function https(
  path: string,
  method: string,
  headers: Record<string, string>,
): Promise<{ status: number; retryAfter?: string }> {
  return new Promise((resolve) => {
    const options = { host: source, port: 443, servername: "pds.unset.test", path, method, agent };
    const req = httpsRequest({ ...options, headers: { host: "pds.unset.test", ...headers } }, (res) => {
      res.resume();
      const retryAfter = res.headers["retry-after"];
      res.on("end", () => resolve({ status: res.statusCode ?? 0, ...(retryAfter ? { retryAfter } : {}) }));
    });
    req.on("error", () => resolve({ status: -1 }));
    req.end();
  });
}

function http(port: number, path: string): Promise<number> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, localAddress: source, timeout: 2000 }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(-1));
    req.end();
  });
}

function garbage(): Promise<void> {
  return new Promise((resolve) => {
    const socket = connect({ host: source, port: 443, localAddress: source }, () =>
      socket.end("\u0016\u0003\u0001 not a tls hello\r\n\r\n"),
    );
    socket.on("close", () => resolve());
    socket.on("error", () => resolve());
    socket.resume();
  });
}

async function run(step: Step): Promise<Result> {
  if (step.kind === "garbage") {
    await garbage();
    return { statuses: [] };
  }
  if (step.kind === "http") return { statuses: [await http(step.port, step.path)] };
  const result: Result = { statuses: [] };
  for (let i = 0; i < (step.count ?? 1); i++) {
    const { status, retryAfter } = await https(step.path, step.method ?? "GET", step.headers ?? {});
    result.statuses.push(status);
    if (retryAfter !== undefined) result.retryAfter = retryAfter;
  }
  return result;
}

const results: Result[] = [];
for (const step of steps) results.push(await run(step));
agent.destroy();
process.stdout.write(JSON.stringify(results));
