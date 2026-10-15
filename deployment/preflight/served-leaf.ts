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
import { connect } from "node:tls";

/** The edge's published TLS port, 127.0.0.1:443 in compose.local.yaml. */
const EDGE = { host: "127.0.0.1", port: 443 };
/** The whole check, edge start included, ends by this (RE-1); one attempt never outlives it. */
const DEADLINE_MS = 60_000;
const ATTEMPT_MS = 5_000;
const RETRY_MS = 500;
/** What a port that is not listening yet, or a server still starting, answers: worth another try. */
const NOT_READY = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"]);
const DNS = /^DNS:([a-z0-9.-]+)$/;

const MISMATCH = "the edge serves a leaf other than unset-dev-env/local-leaf.pem: regenerate the leaf and its copy";

export type ServedLeafCheck = { hosts: string[]; copy: string; root: string; port: number; deadlineMs: number };
type Attempt = { fingerprint: string } | { error: string };

/** Why the edge does not serve exactly the copy for every host, or null when it does. */
export async function servedLeafProblem(check: ServedLeafCheck): Promise<string | null> {
  const expected = new X509Certificate(check.copy).fingerprint256;
  const deadline = Date.now() + check.deadlineMs;
  for (const host of check.hosts) {
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
function handshake({ root, port }: ServedLeafCheck, host: string, deadline: number): Promise<Attempt> {
  return new Promise((settle) => {
    const socket = connect({ host: EDGE.host, port, servername: host, ca: root, rejectUnauthorized: true });
    socket.setTimeout(Math.max(1, Math.min(ATTEMPT_MS, deadline - Date.now())), () =>
      socket.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
    );
    socket.once("secureConnect", () => {
      settle({ fingerprint: socket.getPeerCertificate().fingerprint256 });
      socket.end();
    });
    socket.once("error", (error: NodeJS.ErrnoException) => settle({ error: error.code ?? "UNKNOWN" }));
  });
}

/** The DNS names the copy is for: the hosts the edge must serve it on. C18 has already refused any other kind. */
function hostsOf(copy: string): string[] {
  return (new X509Certificate(copy).subjectAltName ?? "").split(", ").flatMap((name) => DNS.exec(name)?.[1] ?? []);
}

if (import.meta.main) {
  // Beside the checkout, where the preflight read them (checks/local-leaf.ts).
  const beside = (path: string) => join(dirname(resolve(import.meta.dirname, "../..")), path);
  const copy = readFileSync(beside("unset-dev-env/local-leaf.pem"), "utf8");
  const root = readFileSync(beside("unset-dev-trust/root.pem"), "utf8");
  const problem = await servedLeafProblem({
    hosts: hostsOf(copy),
    copy,
    root,
    port: EDGE.port,
    deadlineMs: DEADLINE_MS,
  });
  process.stderr.write(`leaf check: ${problem ?? "the edge serves unset-dev-env/local-leaf.pem"}\n`);
  process.exitCode = problem === null ? 0 : 1;
}
