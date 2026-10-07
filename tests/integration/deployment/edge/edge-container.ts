// The edge under test (P1.28, algorithm steps 1 and 6): the image built from deployment/edge, started with the
// shipped Caddyfile, snippets and PDS site, Caddy's internal CA in place of Let's Encrypt (fixtures/tls.caddy), and a
// stub upstream on the Docker bridge that records what reached it. Hardening as for Postgres (tests/support/
// postgres.ts): --rm-like removal even on failure, the ports published on 127.0.0.1 only, a read-only root, no
// --privileged or host network, and the mounts read-only.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"; // guard-allow: egress local edge test only
import { request } from "node:https"; // guard-allow: egress local edge test only
import { connect as tcpConnect } from "node:net"; // guard-allow: egress local edge test only
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls"; // guard-allow: egress local edge test only

const REPOSITORY = join(import.meta.dirname, "..", "..", "..", "..");
export const EDGE = join(REPOSITORY, "deployment", "edge");
export const PDS_HOST = "pds.unset.test";
const OWNER_LABEL = "sh.unset.test-owner";

/** One request as the stub upstream saw it. */
export interface Seen {
  readonly method: string;
  readonly rawPath: string;
  readonly headers: IncomingHttpHeaders;
}

export interface Response {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
}

export type ProbeStep =
  | { kind: "https"; path: string; method?: string; count?: number; headers?: Record<string, string> }
  | { kind: "http"; port: number; path: string }
  | { kind: "garbage" };
export interface ProbeResult {
  readonly statuses: number[];
  readonly retryAfter?: string;
}

export interface Edge {
  readonly image: string;
  /** Every request the stub upstream received, in order. */
  readonly seen: Seen[];
  /** Sends `path` exactly as written (no normalising) to the PDS host over TLS from the test process. */
  send(path: string, headers?: Readonly<Record<string, string>>): Promise<Response>;
  /** Runs `steps` from `source`, a loopback address inside the edge's network namespace (fixtures/probe.ts). */
  probe(source: string, steps: readonly ProbeStep[]): Promise<ProbeResult[]>;
  /** Runs a command inside the container; its exit code and output. */
  exec(args: readonly string[]): { code: number; out: string };
  /** Opens a TCP connection to 443, writes `bytes` without TLS, and waits for the edge to close it. */
  garbage(bytes: string): Promise<void>;
  /** Sends a malformed HTTP request line over TLS. */
  malformed(): Promise<void>;
  /** Everything the container wrote: stdout (access log) and stderr (default log). */
  logs(): { stdout: string; stderr: string };
  stop(): Promise<void>;
}

/** The pinned Node image the probe runs in (the node-app base, deployment/images/bases.lock.json). */
function nodeImage(): string {
  const lock = JSON.parse(readFileSync(join(REPOSITORY, "deployment", "images", "bases.lock.json"), "utf8"));
  return `${lock.node.ref}:${lock.node.tag}@${lock.node.digest}`;
}

/**
 * Pulls the probe's pinned node image unless it is already present, so no test pays for the pull: on a fresh CI
 * runner the first probe used to pull it inside edge_logs_no_client_address and pass vitest's 5 s (P1.28b).
 */
export function pullProbeImage(): void {
  if (docker(["image", "inspect", nodeImage()]).code === 0) return;
  const pulled = docker(["pull", "-q", nodeImage()]);
  if (pulled.code !== 0) throw new Error(`probe image pull failed: ${pulled.err.slice(-2000)}`);
}

/** Runs docker without blocking the event loop, which answers for the stub upstream. */
function dockerAsync(args: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}

export function docker(args: readonly string[], input?: string): { code: number; out: string; err: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

/** Builds deployment/edge/Dockerfile and returns the image id. */
export function buildEdgeImage(): string {
  const built = docker(["build", "-q", "-f", join(EDGE, "Dockerfile"), EDGE]);
  if (built.code !== 0) throw new Error(`edge image build failed: ${built.err.slice(-2000)}`);
  return built.out.trim();
}

/** The bridge gateway: the stub listens there, so only containers on the bridge reach it. */
function bridgeGateway(): string {
  const inspected = docker(["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"]);
  if (inspected.code !== 0 || inspected.out.trim() === "") throw new Error("no docker bridge gateway");
  return inspected.out.trim();
}

function startStub(host: string, seen: Seen[]): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    seen.push({ method: req.method ?? "", rawPath: req.url ?? "", headers: req.headers });
    // An upstream failure on request: the edge answers 502 and logs it at ERROR (edge_logs_no_client_address).
    if (req.headers["x-stub-fail"] !== undefined) return req.socket.destroy();
    req.resume();
    res.writeHead(200, { "content-type": "application/json", server: "stub", "x-stub": "1" });
    res.end("{}");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("stub has no port"));
      resolve({ server, port: address.port });
    });
  });
}

function hostPort(name: string, port: number): number {
  const mapped = docker(["port", name, `${port}/tcp`]);
  const found = /127\.0\.0\.1:(\d+)/.exec(mapped.out)?.[1];
  if (found === undefined) throw new Error(`no published port for ${port}: ${mapped.out}${mapped.err}`);
  return Number(found);
}

async function waitHealthy(name: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = docker(["inspect", "--format", "{{.State.Health.Status}}", name]).out.trim();
    if (status === "healthy") return;
    if (status === "") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`edge not healthy: ${docker(["logs", name]).err.slice(-2000)}`);
}

/** Starts the edge with the shipped config and a fresh stub upstream. */
export async function startEdge(image: string): Promise<Edge> {
  const seen: Seen[] = [];
  const gateway = bridgeGateway();
  const stub = await startStub(gateway, seen);
  const name = `unset-edge-${process.pid}-${Date.now()}`;
  const ro = (from: string, to: string) => ["-v", `${from}:${to}:ro`];
  const run = docker([
    "run",
    "-d",
    "--name",
    name,
    "--label",
    `${OWNER_LABEL}=${process.pid}`,
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/data:uid=65532,gid=65532",
    "--tmpfs",
    "/config:uid=65532,gid=65532",
    "--add-host",
    `${PDS_HOST}:127.0.0.1`,
    "-p",
    "127.0.0.1::443",
    "-e",
    "ACME_EMAIL=edge@unset.test",
    "-e",
    `PDS_HOST=${PDS_HOST}`,
    "-e",
    `PDS_UPSTREAM=${gateway}:${stub.port}`,
    ...ro(join(import.meta.dirname, "fixtures", "tls.caddy"), "/etc/caddy/snippets/tls.caddy"),
    ...ro(join(EDGE, "sites", "pds.caddy"), "/etc/caddy/sites/enabled/pds.caddy"),
    image,
  ]);
  if (run.code !== 0) {
    stub.server.close();
    throw new Error(`edge did not start: ${run.err}`);
  }
  const stop = async () => {
    docker(["rm", "-f", name]);
    await new Promise((resolve) => stub.server.close(resolve));
  };
  try {
    await waitHealthy(name, 30_000);
    const port = hostPort(name, 443);
    const ca = await readRootCa(name);
    return edgeHandle(name, image, port, ca, seen, stop);
  } catch (error) {
    await stop();
    throw error;
  }
}

/** The internal CA's root, so the test client verifies the edge's certificate instead of skipping verification. */
async function readRootCa(name: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const root = docker(["exec", name, "cat", "/data/caddy/pki/authorities/local/root.crt"]);
    if (root.code === 0 && root.out.includes("BEGIN CERTIFICATE")) return root.out;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the edge's internal CA root did not appear");
}

function edgeHandle(
  name: string,
  image: string,
  port: number,
  ca: string,
  seen: Seen[],
  stop: () => Promise<void>,
): Edge {
  const tls = { host: "127.0.0.1", port, servername: PDS_HOST, ca };
  return {
    image,
    seen,
    send: (path, headers = {}) =>
      new Promise((resolve, reject) => {
        const req = request({ ...tls, path, method: "GET", headers: { host: PDS_HOST, ...headers } }, (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
        });
        req.on("error", reject);
        req.end();
      }),
    probe: async (source, steps) => {
      const probe = join(import.meta.dirname, "fixtures", "probe.ts");
      const ran = await dockerAsync([
        "run",
        "--rm",
        "--network",
        `container:${name}`,
        "--read-only",
        "--user",
        "65532:65532",
        "-e",
        `CA=${ca}`,
        ...["-v", `${probe}:/probe/probe.ts:ro`],
        nodeImage(),
        ...["node", "/probe/probe.ts", source, JSON.stringify(steps)],
      ]);
      if (ran.code !== 0) throw new Error(`probe failed: ${ran.err.slice(-2000)}`);
      return JSON.parse(ran.out) as ProbeResult[];
    },
    exec: (args) => {
      const ran = docker(["exec", name, ...args]);
      return { code: ran.code, out: ran.out + ran.err };
    },
    garbage: (bytes) =>
      new Promise((resolve) => {
        const socket = tcpConnect({ host: "127.0.0.1", port }, () => socket.end(bytes));
        socket.on("close", () => resolve());
        socket.on("error", () => resolve());
        socket.resume();
      }),
    malformed: () =>
      new Promise((resolve) => {
        const socket = tlsConnect(tls, () => socket.end("GET /\u0001 HTTP/9.9\r\nHost: \r\n\r\n"));
        socket.on("close", () => resolve());
        socket.on("error", () => resolve());
        socket.resume();
      }),
    logs: () => {
      const logs = docker(["logs", name]);
      return { stdout: logs.out, stderr: logs.err };
    },
    stop,
  };
}

/** The edge's logs once `ready` holds for them, or as they are after 3 s, so the caller's assertions say what is missing. */
export async function logsWhen(
  edge: Edge,
  ready: (logs: { stdout: string; stderr: string }) => boolean,
): Promise<{ stdout: string; stderr: string }> {
  const deadline = Date.now() + 3000;
  let logs = edge.logs();
  while (!ready(logs) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    logs = edge.logs();
  }
  return logs;
}
