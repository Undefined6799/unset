// The check `local:up` runs after the local stack starts (P1.34d item 15; leaf-copy ruling, last section of book edit
// 2026-10-14-p134d-split). The preflight judged unset-dev-env/local-leaf.pem, the public copy of the leaf, because it
// cannot read the leaf secret itself; this proves the edge serves those same bytes for every local host. For each DNS
// name in the copy it opens TLS to the edge's loopback port with that server name, verifying against the dev root
// only, and compares the served certificate's SHA-256 with the copy's. It prints a fixed line, never a certificate,
// a host or a fingerprint (SE-7; book edit 2026-10-14-verify-857-fixes, S2(b)).
//
// node:tls and node:crypto, Node v26 (https://nodejs.org/docs/latest-v26.x/api/tls.html#certificate-object and
// .../crypto.html#x509fingerprint256): getPeerCertificate().fingerprint256 and X509Certificate#fingerprint256 are both
// the SHA-256 of the DER bytes as colon-separated hex, which served-leaf.test.ts checks against a real server.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type ConnectionOptions, type TLSSocket, connect as tlsConnect } from "node:tls"; // guard-allow: egress loopback leaf probe, fixed 127.0.0.1:443

/**
 * The edge's published TLS port in compose.local.yaml, and the only place this check connects. The architecture ruling
 * that allows the connect above (02:58Z, last section of book edit 2026-10-14-p134d-split) holds because this code
 * makes its reason true: these constants, no parameter, env read or DNS lookup for the address; local only; names only
 * from the leaf's DNS SANs, each under .localhost; the dev root only; nothing sent after the handshake.
 */
const EDGE = { host: "127.0.0.1", port: 443 } as const;
/** The whole check, edge start included, ends by this (RE-1); one attempt never outlives it. */
const DEADLINE_MS = 60_000;
const ATTEMPT_MS = 5_000;
const RETRY_MS = 500;
/** What a port that is not listening yet, or a server still starting, answers: worth another try. */
const NOT_READY = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"]);
/** A DNS SAN under .localhost, the names the dev root is constrained to (p127l Amendment 2, section 1). */
const LOCAL_SAN = /^DNS:((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+localhost)$/;

const MISMATCH = "the edge serves a leaf other than unset-dev-env/local-leaf.pem: regenerate the leaf and its copy";

export type Connect = (options: ConnectionOptions) => TLSSocket;
/** `connect` is node:tls's unless a test passes one; it is always called with EDGE's address. */
export type ServedLeafCheck = { env: string; copy: string; root: string; deadlineMs: number; connect?: Connect };
type Attempt = { fingerprint: string } | { error: string };

/** Why the edge does not serve exactly the copy for every host, or null when it does. Refusals come before any connect. */
export async function servedLeafProblem(check: ServedLeafCheck): Promise<string | null> {
  if (check.env !== "local") return "the leaf check runs only under --env local";
  const leaf = new X509Certificate(check.copy);
  const hosts = localHosts(leaf);
  if (hosts === null) return "the leaf names something other than hosts under .localhost";
  const expected = leaf.fingerprint256;
  const deadline = Date.now() + check.deadlineMs;
  for (const host of hosts) {
    const served = await untilReady(() => handshake(check, host, deadline), deadline);
    if (served === null) return "the edge did not answer in time";
    if ("error" in served)
      return `the edge's leaf does not verify against unset-dev-trust/root.pem (${served.error}): regenerate unset-dev-env/local-leaf.pem`;
    if (served.fingerprint !== expected) return MISMATCH;
  }
  return null;
}

/** Retries an attempt the edge was not ready for, until the deadline; null when it never became ready. */
async function untilReady(attempt: () => Promise<Attempt>, deadline: number): Promise<Attempt | null> {
  while (Date.now() < deadline) {
    const result = await attempt();
    if (!("error" in result) || !NOT_READY.has(result.error)) return result;
    await new Promise((later) => setTimeout(later, RETRY_MS));
  }
  return null;
}

/** One TLS handshake for `host`, trusting the dev root only; the served leaf's SHA-256, or the error's code. */
function handshake({ root, connect = tlsConnect }: ServedLeafCheck, host: string, deadline: number): Promise<Attempt> {
  return new Promise((settle) => {
    const socket = connect({ ...EDGE, servername: host, ca: root, rejectUnauthorized: true });
    // A wall-clock limit per attempt, not an idle timer, so an edge that trickles bytes cannot hold it open either.
    const timer = setTimeout(
      () => socket.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
      Math.max(1, Math.min(ATTEMPT_MS, deadline - Date.now())),
    );
    socket.once("close", () => clearTimeout(timer));
    socket.once("secureConnect", () => {
      settle({ fingerprint: socket.getPeerCertificate().fingerprint256 });
      socket.destroy();
    });
    socket.once("error", (error: NodeJS.ErrnoException) => settle({ error: error.code ?? "UNKNOWN" }));
  });
}

/** The hosts the edge must serve the leaf on: its SANs, each a DNS name under .localhost, else null. */
function localHosts(leaf: X509Certificate): string[] | null {
  const names = (leaf.subjectAltName ?? "").split(", ").filter((name) => name !== "");
  const hosts = names.map((name) => LOCAL_SAN.exec(name)?.[1] ?? null);
  return hosts.length > 0 && hosts.every((host) => host !== null) ? (hosts as string[]) : null;
}

/**
 * The env of `node served-leaf.ts -- --env <env>`, the one form stack.ts calls, so Node never reads an argument as one
 * of its own flags (docs/ai/notes/pitfall/node-reads-env-file-after-script.md); null for any other argv.
 */
export function leafEnv(argv: readonly string[]): string | null {
  const [separator, flag, env, ...rest] = argv;
  return separator === "--" && flag === "--env" && env !== undefined && rest.length === 0 ? env : null;
}

if (import.meta.main) {
  // The argv is judged before any file is read, so a wrong form fails with the usage line alone.
  const env = leafEnv(process.argv.slice(2));
  let problem: string | null = "usage: served-leaf.ts -- --env local";
  if (env !== null) {
    // Beside the checkout, where the preflight read them (checks/local-leaf.ts).
    const beside = (path: string) => join(dirname(resolve(import.meta.dirname, "../..")), path);
    const copy = readFileSync(beside("unset-dev-env/local-leaf.pem"), "utf8");
    const root = readFileSync(beside("unset-dev-trust/root.pem"), "utf8");
    problem = await servedLeafProblem({ env, copy, root, deadlineMs: DEADLINE_MS });
  }
  process.stderr.write(`leaf check: ${problem ?? "the edge serves unset-dev-env/local-leaf.pem"}\n`);
  process.exitCode = problem === null ? 0 : 1;
}
