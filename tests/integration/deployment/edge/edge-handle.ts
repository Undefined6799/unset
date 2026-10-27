// A started edge as the tests use it (P1.28; split from edge-container.ts, P1.34g): the types a test reads, the probe
// image and its async docker run, and the handle that sends, probes, execs and reads logs. edge-container.ts builds,
// starts and stops the container behind it.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http"; // guard-allow: egress local edge test only
import { request } from "node:https"; // guard-allow: egress local edge test only
import { connect as tcpConnect } from "node:net"; // guard-allow: egress local edge test only
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls"; // guard-allow: egress local edge test only
import { docker, killBefore, subcommand } from "../../../support/docker.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..", "..");
export const PDS_HOST = "pds.unset.test";
// Every docker call is killed at its own budget (P1.27k), so a hung daemon fails the calling test or hook with a named
// message instead of blocking the event loop until scripts/test/run.ts kills the whole run at 600 s. A daemon call
// (inspect, port, exec, logs, rm) may queue behind CI's parallel image builds but never for a minute. The pull and
// the build share beforeAll's 600 s with the start; a probe run fits inside the 120 s budget of the tests that probe
// (CONTAINER_MS in edge.image.test.ts).
export const CALL_MS = 60_000;
const PULL_MS = 180_000;
const PROBE_MS = killBefore(120_000);

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
  /** The fresh named volume at /data, seeded from the image as a deployment's would be (P1.27o). */
  readonly dataVolume: string;
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
  if (docker(["image", "inspect", nodeImage()], { timeoutMs: CALL_MS }).code === 0) return;
  const pulled = docker(["pull", "-q", nodeImage()], { timeoutMs: PULL_MS });
  if (pulled.code !== 0) throw new Error(`probe image pull failed: ${pulled.err.slice(-2000)}`);
}

/** Runs docker without blocking the event loop, which answers for the stub upstream; killed at `timeoutMs` (P1.27k). */
function dockerAsync(args: readonly string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("close", (code, signal) =>
      resolve({
        code: code ?? -1,
        out,
        err: signal === "SIGKILL" ? `docker ${subcommand(args)} killed after ${timeoutMs} ms` : err,
      }),
    );
  });
}

/** The handle on a started edge container `name`; `stop` is the start's own removal (edge-container.ts). */
export function edgeHandle(
  name: string,
  image: string,
  dataVolume: string,
  port: number,
  ca: string,
  seen: Seen[],
  stop: () => Promise<void>,
): Edge {
  const tls = { host: "127.0.0.1", port, servername: PDS_HOST, ca };
  return {
    image,
    dataVolume,
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
      const ran = await dockerAsync(
        [
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
        ],
        PROBE_MS,
      );
      if (ran.code !== 0) throw new Error(`probe failed: ${ran.err.slice(-2000)}`);
      return JSON.parse(ran.out) as ProbeResult[];
    },
    exec: (args) => {
      const ran = docker(["exec", name, ...args], { timeoutMs: CALL_MS });
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
      const logs = docker(["logs", name], { timeoutMs: CALL_MS });
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
