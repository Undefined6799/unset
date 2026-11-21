// chat-admin's one outbound file (ADR 0081 decision 5, the egress guard's exemption): every connection it opens starts
// here, to an internal http origin checked at boot, through a lookup that refuses a public answer on every connection.
// Each call has its own deadline inside the caller's (RE-1) and a cap on what it reads; any answer is parsed into a
// status and a JSON object (an empty one when the body is not JSON), and every failure throws the caller's error.
import { request } from "node:http";
import { type Resolve, systemResolve, vettedLookup } from "@unset/shared-admin-envelope";

export type Answer = { readonly status: number; readonly body: Record<string, unknown> };
export type Send = (url: URL, method: string, headers: Record<string, string>, body?: string) => Promise<Answer>;

/** Each call's whole deadline, and the most any answer may hold. */
const TIMEOUT_MS = 5_000;
const CAP = 64 * 1024;

/** A sender whose failures are `new Unavailable(reason)`: public_answer, cap, read, deadline, timeout or connect. */
export function createSender(Unavailable: new (reason: string) => Error, resolve: Resolve = systemResolve): Send {
  const fail = (reason: string) => new Unavailable(reason);
  const lookup = vettedLookup(resolve, () => fail("public_answer"));
  return (url, method, given, body) =>
    new Promise<Answer>((resolveAnswer, reject) => {
      // A body always carries its length: Node 26.12.0 sends a DELETE's body with neither a length nor chunking, which
      // a server answers 400 (checked against node:http's own server, 2026-11-21).
      const headers = body === undefined ? given : { ...given, "content-length": String(Buffer.byteLength(body)) };
      const req = request(url, { method, headers, timeout: TIMEOUT_MS, lookup }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > CAP) return req.destroy(fail("cap"));
          chunks.push(chunk);
        });
        res.on("end", () => {
          let parsed: unknown = {};
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            // Not JSON: an empty body, which every parser refuses.
          }
          const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
          resolveAnswer({ status: res.statusCode ?? 0, body: record });
        });
        res.on("error", () => reject(fail("read")));
      });
      const deadline = setTimeout(() => req.destroy(fail("deadline")), TIMEOUT_MS);
      req.on("close", () => clearTimeout(deadline));
      req.on("timeout", () => req.destroy(fail("timeout")));
      // Only our own failures keep their reason; anything else from the socket is a failed connection.
      req.on("error", (error) => reject(error instanceof Unavailable ? error : fail("connect")));
      req.end(body);
    });
}

/** Reads a nested field of a parsed answer, or undefined. */
export const field = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((at, key) => (typeof at === "object" && at !== null ? Reflect.get(at, key) : undefined), value);
