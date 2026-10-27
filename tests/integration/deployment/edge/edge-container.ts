// The edge under test (P1.28, algorithm steps 1 and 6): the image built from deployment/edge, started with the
// shipped Caddyfile, snippets and PDS site, Caddy's internal CA in place of Let's Encrypt (fixtures/tls.caddy), and a
// stub upstream on the Docker bridge that records what reached it. Hardening as for Postgres (tests/support/
// postgres.ts): --rm-like removal even on failure, the ports published on 127.0.0.1 only, a read-only root, no
// --privileged or host network, and the mounts read-only.
import { createServer, type Server } from "node:http"; // guard-allow: egress local edge test only
import { join } from "node:path";
import { docker, failAfterCleanup } from "../../../support/docker.ts";
import { buildTestImage, removeTestImage } from "../../../support/image-build.ts";
import { CALL_MS, type Edge, edgeHandle, PDS_HOST, type Seen } from "./edge-handle.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..", "..");
export const EDGE = join(REPOSITORY, "deployment", "edge");
const OWNER_LABEL = "sh.unset.test-owner";
// The pull and the build share beforeAll's 600 s with the start (edge-suite.ts); every other docker call is killed
// at CALL_MS (edge-handle.ts).
const BUILD_MS = 300_000;

/** Builds deployment/edge/Dockerfile under its own tag (P1.27x) and returns the tag; removeTestImage removes it. */
export function buildEdgeImage(): string {
  return buildTestImage(join(EDGE, "Dockerfile"), EDGE, { timeoutMs: BUILD_MS });
}

/**
 * The docker calls stopEdgeAndRemoveImage can make, each killed at CALL_MS: the stop's `rm -f` and `volume rm`, then
 * the tag's `rmi`. The suite's teardown budget is derived from it (edge-suite.ts), and edge-exit-codes.image.test.ts
 * counts the calls, so a new one fails there instead of outrunning the budget (N3, P1.34g; RE-1).
 */
export const TEARDOWN_DOCKER_CALLS = 3;

/**
 * Stops the edge, then removes the image tag the suite built, even when the stop failed; when both fail, one
 * AggregateError holds both, the stop's first (P1.11i). Only the tag goes, never -f: since P1.27z the trusted edge
 * tests build and remove tags of their own, so removing this one deletes nothing they hold.
 */
export async function stopEdgeAndRemoveImage(edge: Pick<Edge, "stop"> | undefined, image: string | undefined) {
  const remove = () => {
    if (image !== undefined) removeTestImage(image, { timeoutMs: CALL_MS });
  };
  try {
    await edge?.stop();
  } catch (failure) {
    failAfterCleanup(failure, remove);
  }
  remove();
}

/**
 * Removes the edge container. docker() returns a non-zero code without throwing (tests/support/docker.ts), so the code
 * is checked here and a refused removal names the container with docker's own message (P1.11s).
 */
function removeContainer(name: string, timeoutMs: number): void {
  const removed = docker(["rm", "-f", name], { timeoutMs });
  if (removed.code !== 0) throw new Error(`docker rm failed (${name}): ${removed.err.trim()}`);
}

/**
 * Removes the edge's /data volume, after its container, which holds it while it exists. Checked like removeContainer:
 * a volume that stays would seed nothing for the next run but would leak (P1.27o; DC-4).
 */
function removeVolume(volume: string, timeoutMs: number): void {
  const removed = docker(["volume", "rm", "-f", volume], { timeoutMs });
  if (removed.code !== 0) throw new Error(`docker volume rm failed (${volume}): ${removed.err.trim()}`);
}

/** The bridge gateway: the stub listens there, so only containers on the bridge reach it. */
function bridgeGateway(callMs: number): string {
  const inspected = docker(["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"], {
    timeoutMs: callMs,
  });
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
  const mapped = docker(["port", name, `${port}/tcp`], { timeoutMs: CALL_MS });
  const found = /127\.0\.0\.1:(\d+)/.exec(mapped.out)?.[1];
  if (found === undefined) throw new Error(`no published port for ${port}: ${mapped.out}${mapped.err}`);
  return Number(found);
}

async function waitHealthy(name: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = docker(["inspect", "--format", "{{.State.Health.Status}}", name], { timeoutMs: CALL_MS }).out.trim();
    if (status === "healthy") return;
    if (status === "") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`edge not healthy: ${docker(["logs", name], { timeoutMs: CALL_MS }).err.slice(-2000)}`);
}

/**
 * Starts the edge with the shipped config and a fresh stub upstream. `callMs` kills the docker calls the start and the
 * removal make; only a test of a killed start lowers it.
 */
export async function startEdge(image: string, callMs = CALL_MS): Promise<Edge> {
  const seen: Seen[] = [];
  const gateway = bridgeGateway(callMs);
  const stub = await startStub(gateway, seen);
  const name = `unset-edge-${process.pid}-${Date.now()}`;
  const dataVolume = dataVolumeOf(name);
  const ro = (from: string, to: string) => ["-v", `${from}:${to}:ro`];
  // Defined before the run: a killed `run -d` may still have created the container, and the stub must close (N6).
  const closeStub = () =>
    new Promise<void>((resolve, reject) => stub.server.close((error) => (error ? reject(error) : resolve())));
  // A removal that fails is reported, not dropped, and the stub still closes; when that fails too, the AggregateError
  // holds both, the removal's first (P1.11s).
  const stop = async () => {
    try {
      removeContainer(name, callMs);
      removeVolume(dataVolume, callMs);
    } catch (failure) {
      const closeFailure = await closeStub().then(
        () => null,
        (error: unknown) => error,
      );
      failAfterCleanup(failure, () => {
        if (closeFailure !== null) throw closeFailure;
      });
    }
    await closeStub();
  };
  try {
    // Created here, labelled like the container, so a volume a killed run leaks can be found by its owner label.
    const created = docker(["volume", "create", "--label", `${OWNER_LABEL}=${process.pid}`, dataVolume], {
      timeoutMs: callMs,
    });
    if (created.code !== 0) throw new Error(`docker volume create failed: ${created.err.trim()}`);
    const run = docker(
      [
        "run",
        "-d",
        "--name",
        name,
        "--label",
        `${OWNER_LABEL}=${process.pid}`,
        "--read-only",
        "--tmpfs",
        "/tmp",
        // A fresh named volume, not tmpfs: Docker seeds it from the image's /data, owner and mode included, as on a
        // deployed edge, so a root-owned /data in the image fails here (P1.27o).
        "-v",
        `${dataVolume}:/data`,
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
      ],
      { timeoutMs: callMs },
    );
    if (run.code !== 0) throw new Error(`edge did not start: ${run.err}`);
    await waitHealthy(name, 30_000);
    const port = hostPort(name, 443);
    const ca = await readRootCa(name);
    return edgeHandle(name, image, dataVolume, port, ca, seen, stop);
  } catch (error) {
    // A killed removal must not hide why the start failed.
    await stop().catch(() => undefined);
    throw error;
  }
}

/** The edge container's /data volume, named after the container; stop removes both. */
const dataVolumeOf = (name: string): string => `${name}-data`;

/** The internal CA's root, so the test client verifies the edge's certificate instead of skipping verification. */
async function readRootCa(name: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const root = docker(["exec", name, "cat", "/data/caddy/pki/authorities/local/root.crt"], { timeoutMs: CALL_MS });
    if (root.code === 0 && root.out.includes("BEGIN CERTIFICATE")) return root.out;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the edge's internal CA root did not appear");
}
