// The PDS calls (P2.09 steps 9, 11 and check-reserved). The only file in pds-admin that opens a connection, and only
// to PDS_INTERNAL_URL, an internal origin checked at boot (ADR 0060 decisions 1 and 6; the egress guard's single
// exemption). Methods and shapes read from @atproto/pds 0.5.51: admin/getAccountInfo.ts (400 NotFound),
// admin/getSubjectStatus.ts, server/createInviteCode.ts (adminToken, body {useCount, forAccount}).
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:http";
import { BlockList, isIP, type LookupFunction } from "node:net";

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

/** Loopback, private, link-local and unique-local ranges: the PDS must answer only from these. */
const INTERNAL = new BlockList();
for (const [net, bits] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
] as const)
  INTERNAL.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  INTERNAL.addSubnet(net, bits, "ipv6");

/** Whether every answer is internal (and there is at least one). */
export const allInternal = (answers: readonly LookupAddress[]): boolean =>
  answers.length > 0 && answers.every(({ address, family }) => INTERNAL.check(address, family === 6 ? "ipv6" : "ipv4"));

/** Resolves a host name to all its addresses; a port so a test can play DNS (rule AB-2). */
export type Resolve = (host: string, done: (error: Error | null, answers: LookupAddress[]) => void) => void;
export const systemResolve: Resolve = (host, done) => dnsLookup(host, { all: true }, done);

/**
 * The lookup each connection makes: the answers it will connect to are the ones checked, so a DNS change after boot
 * cannot send the admin password to a public address. Any non-internal answer refuses the whole lookup.
 */
function vettedLookup(resolve: Resolve): LookupFunction {
  return (host, options, callback) => {
    resolve(host, (error, answers) => {
      if (error) return callback(error, "", 0);
      if (!allInternal(answers)) return callback(new PdsUnavailable("public answer"), "", 0);
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, answers);
      const first = answers[0] as LookupAddress;
      callback(null, first.address, first.family);
    });
  };
}

/** Where `origin`'s host resolves: only to internal addresses, to any public one, or (for now) nowhere. */
export type Resolution = "internal" | "public" | "unresolved";

/**
 * The boot check (P2.09 step 13). A public answer stops the boot; a name that does not resolve yet (the PDS container
 * not started) is not a refusal, because every later connection makes the same check (vettedLookup).
 */
export function resolvesInternal(origin: URL, resolve: Resolve = systemResolve): Promise<Resolution> {
  const host = origin.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const judge = (answers: readonly LookupAddress[]): Resolution => (allInternal(answers) ? "internal" : "public");
  if (family !== 0) return Promise.resolve(judge([{ address: host, family }]));
  return new Promise((done) =>
    resolve(host, (error, answers) => done(error !== null || answers.length === 0 ? "unresolved" : judge(answers))),
  );
}

/** A client for one origin. `password` builds only the Basic header (user `admin`, the PDS's admin token). */
export function createPds(origin: URL, password: string, resolve: Resolve = systemResolve): Pds {
  const lookup = vettedLookup(resolve);
  const auth = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  const call = (method: "GET" | "POST", path: string, cap: number, body?: object, admin = true) =>
    new Promise<PdsAnswer>((resolve, reject) => {
      const url = new URL(path, origin);
      if (url.origin !== origin.origin) return reject(new PdsUnavailable("origin"));
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const headers: Record<string, string> = { accept: "application/json" };
      if (admin) headers.authorization = auth;
      if (payload !== undefined) headers["content-type"] = "application/json";
      const req = request(url, { method, headers, timeout: TIMEOUT_MS, lookup }, (res) => {
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
      // `timeout` above is per idle socket; this is the whole call's deadline, so a dribbling answer cannot hold the
      // serialized issuing chain (RE-1).
      const deadline = setTimeout(() => req.destroy(new PdsUnavailable("deadline")), TIMEOUT_MS);
      req.on("close", () => clearTimeout(deadline));
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

/**
 * A DID no account can have (a did:plc id is 24 base32 characters), asked about only to learn whether the PDS takes
 * our admin password (P2.09e). It must be a well-formed DID: the PDS's XRPC server validates the query parameters
 * first and authenticates second (@atproto/xrpc-server dist/server.js:220-223 in 0.13.6 and 0.13.13, the ends of the
 * range @atproto/pds 0.5.51 accepts), so a malformed one would be a 400 whatever the password. The route's
 * auth is `moderator`, which takes Basic auth to `adminToken`; a wrong password there is AuthRequiredError, 401
 * (@atproto/pds 0.5.51 dist/auth-verifier.js:33-42 and :61-68, api/com/atproto/admin/getAccountInfo.js). The right
 * password reaches the handler, which answers 400 NotFound for this DID.
 */
export const PROBE_DID = "did:plc:pds-admin-password-probe";

/** What the PDS said about our password: only a 401 refuses it and only NotFound accepts it; anything else is no answer. */
export type PasswordAnswer = "accepted" | "refused" | "unknown";

export async function probePassword(pds: Pds): Promise<PasswordAnswer> {
  let answer: PdsAnswer;
  try {
    answer = await pds.getAccountInfo(PROBE_DID);
  } catch (error) {
    if (error instanceof PdsUnavailable) return "unknown";
    throw error;
  }
  if (answer.status === 401) return "refused";
  const body = answer.body;
  const notFound = typeof body === "object" && body !== null && Reflect.get(body, "error") === "NotFound";
  return answer.status === 400 && notFound ? "accepted" : "unknown";
}

/**
 * The client, with every admin answer of 401 calling `refused` before the caller sees it: the PDS's password changed
 * after this service's probe passed (a one-copy rotation and a PDS restart), so the service stops.
 */
export function watchPassword(pds: Pds, refused: () => void): Pds {
  const watched =
    (call: (arg: string) => Promise<PdsAnswer>) =>
    async (arg: string): Promise<PdsAnswer> => {
      const answer = await call(arg);
      if (answer.status === 401) refused();
      return answer;
    };
  return {
    getAccountInfo: watched(pds.getAccountInfo),
    getSubjectStatus: watched(pds.getSubjectStatus),
    createInviteCode: watched(pds.createInviteCode),
    resolveHandle: pds.resolveHandle,
  };
}
