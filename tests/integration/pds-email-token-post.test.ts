// httpsPost in tests/support/pds-email-token.ts (P1.29h, Amendment 2, S1) against a real TLS server on loopback: it
// connects to the vetted address and nothing else, checks the certificate for the name against the given root only,
// follows no redirect and keeps its deadline. The certificates are made here by openssl, for an RFC 2606 name that
// resolves nowhere, so only the pinned address can reach the server. The cases that depend on the process's own
// environment (a proxy, extra CAs) or that would end the process run httpsPost in a child Node.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https"; // guard-allow: egress local loopback test server only
import { type AddressInfo, createServer as createListener, type Server as Listener } from "node:net"; // guard-allow: egress local loopback stand-in proxy only
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runOrKill } from "../support/docker.ts";
import { httpsPost, type PinnedPost } from "../support/pds-email-token.ts";

const HOST = "pds.example.test";
const dir = mkdtempSync(join(tmpdir(), "pinned-post-"));

/** A self-signed certificate for `name` and its key, made by openssl; it is its own trust root. */
function selfSigned(label: string, name: string): { cert: string; key: string } {
  const [cert, key] = [join(dir, `${label}.crt`), join(dir, `${label}.key`)];
  const made = runOrKill(
    "openssl",
    [
      ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1"],
      ["-subj", `/CN=${name}`, "-addext", `subjectAltName=DNS:${name}`, "-keyout", key, "-out", cert],
    ].flat(),
    { timeoutMs: 20_000 },
  );
  expect(made.code, made.err).toBe(0);
  return { cert: readFileSync(cert, "utf8"), key: readFileSync(key, "utf8") };
}

const pds = selfSigned("pds", HOST);
const stranger = selfSigned("stranger", HOST);
const seen: { host: string | undefined; path: string | undefined; body: string }[] = [];
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer(pds, (req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      seen.push({ host: req.headers.host, path: req.url, body });
      if (req.url === "/silent") return; // never answers: the caller's deadline must end it
      if (req.url === "/moved") {
        res.writeHead(302, { location: `https://${HOST}:${port}/elsewhere` }).end();
        return;
      }
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

const request = (overrides: Partial<PinnedPost> = {}): PinnedPost => ({
  host: HOST,
  address: "127.0.0.1",
  port,
  path: "/xrpc/com.atproto.server.confirmEmail",
  headers: { "content-type": "application/json" },
  body: '{"ok":true}',
  ca: pds.cert,
  timeoutMs: 5_000,
  ...overrides,
});
const post = (overrides: Partial<PinnedPost> = {}) => httpsPost(request(overrides));

const MODULE = pathToFileURL(join(import.meta.dirname, "../support/pds-email-token.ts")).href;
const CHILD = `import { httpsPost } from ${JSON.stringify(MODULE)};
try { console.log(String(await httpsPost(JSON.parse(process.argv[1])))); } catch { console.log("rejected"); }`;

/** httpsPost in a child Node with only `env` (and PATH): its printed status or "rejected", and its exit code. */
function inChild(sent: PinnedPost, env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", CHILD, JSON.stringify(sent)],
      { env: { PATH: process.env.PATH ?? "", ...env }, timeout: 20_000, killSignal: "SIGKILL" },
      (error, stdout) => done({ code: error === null ? 0 : Number(error.code ?? -1), out: stdout.trim() }),
    );
  });
}

describe("httpsPost", () => {
  test("pinned_post_reaches_only_the_vetted_address", async () => {
    seen.length = 0;
    // The name resolves nowhere (RFC 2606), so an answer proves the connection went to the pinned address.
    expect(await post()).toBe(200);
    expect(seen).toEqual([
      { host: `${HOST}:${port}`, path: "/xrpc/com.atproto.server.confirmEmail", body: '{"ok":true}' },
    ]);
  });

  test("pinned_post_checks_the_name_against_the_given_root_only", async () => {
    // A certificate for the name from another root, and the right root presented for another name.
    await expect(post({ ca: stranger.cert })).rejects.toThrow();
    await expect(post({ host: "app.example.test" })).rejects.toThrow();
  });

  test("pinned_post_follows_no_redirect", async () => {
    seen.length = 0;
    expect(await post({ path: "/moved" })).toBe(302);
    expect(seen.map(({ path }) => path)).toEqual(["/moved"]);
  });

  test("pinned_post_ignores_the_environment_proxy", { timeout: 30_000 }, async () => {
    // Coordinator's second review of #786, S1': on Node 26 with NODE_USE_ENV_PROXY=1 the global agent sends requests
    // to HTTPS_PROXY (Node v26.10.0 doc/api/http.md, "Built-in Proxy Support"); `agent: false` keeps the pinned
    // connection. The stand-in proxy records any connection and closes it.
    const reached: number[] = [];
    const proxy: Listener = createListener((socket) => {
      reached.push(1);
      socket.destroy();
    });
    await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
    try {
      const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
      const ran = await inChild(request(), { NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl });
      expect(ran).toEqual({ code: 0, out: "200" });
      expect(reached).toEqual([]);
    } finally {
      await new Promise((done) => proxy.close(done));
    }
  });

  test("pinned_post_trusts_no_root_from_the_environment", { timeout: 30_000 }, async () => {
    // NODE_EXTRA_CA_CERTS extends Node's default store (doc/api/cli.md); the pinned request trusts only `ca`.
    const extra = join(dir, "pds.crt");
    const ran = await inChild(request({ ca: stranger.cert }), { NODE_EXTRA_CA_CERTS: extra });
    expect(ran).toEqual({ code: 0, out: "rejected" });
    // The same child trusts the server when given its root, so the refusal above is the root's.
    expect(await inChild(request(), { NODE_EXTRA_CA_CERTS: extra })).toEqual({ code: 0, out: "200" });
  });

  test("pinned_post_survives_a_connect_that_fails_at_once", { timeout: 30_000 }, async () => {
    // Coordinator's second review of #786, N1: an IPv6 pin on a host without IPv6 fails inside connect() (EAFNOSUPPORT,
    // measured on Node 26.10.0). Linux fails a TCP connect to the limited broadcast address the same way on every host
    // (ENETUNREACH), so it stands in here: the request must reject, not end the process with an unhandled error.
    expect(await inChild(request({ address: "255.255.255.255" }), {})).toEqual({ code: 0, out: "rejected" });
  });

  test("pinned_post_keeps_its_deadline", async () => {
    const started = Date.now();
    await expect(post({ path: "/silent", timeoutMs: 300 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
