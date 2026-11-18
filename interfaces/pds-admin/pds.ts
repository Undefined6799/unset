// The PDS calls (P2.09 steps 9, 11 and check-reserved). The only file in pds-admin that opens a connection, and only
// to PDS_INTERNAL_URL, an internal origin checked at boot (ADR 0060 decisions 1 and 6; the egress guard's single
// exemption). Methods and shapes read from @atproto/pds 0.5.51: admin/getAccountInfo.ts (400 NotFound),
// admin/getSubjectStatus.ts, server/createInviteCode.ts (adminToken, body {useCount, forAccount}).
import { request } from "node:http";

export type PdsAnswer = { readonly status: number; readonly body: unknown };

export type Pds = {
  readonly getAccountInfo: (did: string) => Promise<PdsAnswer>;
  readonly getSubjectStatus: (did: string) => Promise<PdsAnswer>;
  readonly createInviteCode: (forAccount: string) => Promise<PdsAnswer>;
  readonly resolveHandle: (handle: string) => Promise<PdsAnswer>;
};

const TIMEOUT_MS = 5_000;
const READ_CAP = 64 * 1024;
const CREATE_CAP = 4 * 1024;

/** Thrown for a timeout, a refused connection or an answer over its cap; the caller answers 503. */
export class PdsUnavailable extends Error {}

/** A client for one origin. `password` builds only the Basic header (user `admin`, the PDS's admin token). */
export function createPds(origin: URL, password: string): Pds {
  const auth = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  const call = (method: "GET" | "POST", path: string, cap: number, body?: object, admin = true) =>
    new Promise<PdsAnswer>((resolve, reject) => {
      const url = new URL(path, origin);
      if (url.origin !== origin.origin) return reject(new PdsUnavailable("origin"));
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const headers: Record<string, string> = { accept: "application/json" };
      if (admin) headers.authorization = auth;
      if (payload !== undefined) headers["content-type"] = "application/json";
      const req = request(url, { method, headers, timeout: TIMEOUT_MS }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > cap) return req.destroy(new PdsUnavailable("cap"));
          chunks.push(chunk);
        });
        res.on("end", () => {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            // Not JSON: `parsed` stays null and the caller refuses the shape.
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
        res.on("error", () => reject(new PdsUnavailable("read")));
      });
      req.on("timeout", () => req.destroy(new PdsUnavailable("timeout")));
      req.on("error", () => reject(new PdsUnavailable("connect")));
      req.end(payload);
    });
  const query = (nsid: string, key: string, value: string) => `/xrpc/${nsid}?${new URLSearchParams({ [key]: value })}`;
  return {
    getAccountInfo: (did) => call("GET", query("com.atproto.admin.getAccountInfo", "did", did), READ_CAP),
    getSubjectStatus: (did) => call("GET", query("com.atproto.admin.getSubjectStatus", "did", did), READ_CAP),
    createInviteCode: (forAccount) =>
      call("POST", "/xrpc/com.atproto.server.createInviteCode", CREATE_CAP, { useCount: 1, forAccount }),
    resolveHandle: (handle) =>
      call("GET", query("com.atproto.identity.resolveHandle", "handle", handle), READ_CAP, undefined, false),
  };
}
