// Fake remote servers for net-guard tests (TE-1: the network is unmanaged, so tests stand up their own). One
// self-signed certificate covers every test hostname and is passed to the guard as its trusted CA.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LookupAnswer, pinnedLookup } from "./resolve.ts";

export const TEST_HOSTS = ["unset.ac", "bsky.social", "plc.directory", "pds.example", "files.example"];

/** A key and self-signed certificate for TEST_HOSTS, made with the openssl CLI. */
export function testCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "net-guard-tls-"));
  try {
    const san = TEST_HOSTS.map((host) => `DNS:${host}`).join(",");
    const run = spawnSync(
      "openssl",
      ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1"]
        .concat(["-subj", "/CN=unset test", "-addext", `subjectAltName=${san}`])
        .concat(["-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")]),
      { encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`openssl failed: ${run.stderr}`);
    return { key: readFileSync(join(dir, "key.pem"), "utf8"), cert: readFileSync(join(dir, "cert.pem"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;
export type FakeServer = { port: number; requests: IncomingMessage[]; close: () => Promise<void> };

async function listen(server: Server, requests: IncomingMessage[]): Promise<FakeServer> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function httpsServer(tls: { key: string; cert: string }, handler: Handler): Promise<FakeServer> {
  const requests: IncomingMessage[] = [];
  const server = createHttpsServer(tls, (req, res) => {
    requests.push(req);
    handler(req, res);
  });
  return listen(server, requests);
}

export function httpServer(handler: Handler): Promise<FakeServer> {
  const requests: IncomingMessage[] = [];
  const server = createHttpServer((req, res) => {
    requests.push(req);
    handler(req, res);
  });
  return listen(server, requests);
}

/** A resolver stub: each host answers with its listed addresses; every call is recorded. */
export function fakeResolver(answers: Record<string, readonly string[]>) {
  const calls: string[] = [];
  const lookup = async (host: string): Promise<LookupAnswer> => {
    calls.push(host);
    return (answers[host] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return { lookup, calls };
}

/**
 * Socket hooks that keep the pinning visible: the guard's own pinnedLookup chooses the address, the hook records it,
 * then sends the socket to the fake server on loopback instead of the (fake) public address.
 */
export function loopbackDial(port: number) {
  const dialled: string[] = [];
  return {
    dialled,
    hooks: {
      port,
      lookupFor: (addresses: readonly string[]) => {
        const pinned = pinnedLookup(addresses);
        return (host: string, options: unknown, callback: (e: Error | null, a?: unknown, f?: number) => void) =>
          pinned(host, options, (error, address) => {
            if (error) return callback(error);
            const first = Array.isArray(address) ? address[0]?.address : address;
            dialled.push(String(first));
            if (Array.isArray(address)) callback(null, [{ address: "127.0.0.1", family: 4 }]);
            else callback(null, "127.0.0.1", 4);
          });
      },
    },
  };
}
