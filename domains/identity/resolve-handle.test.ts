import { describe, expect, test } from "vitest";
import {
  type FetchRequest,
  type Handle,
  type HttpOutcome,
  type IdentityNetwork,
  parseHandle,
  resolveHandle,
  type TxtOutcome,
} from "./index.ts";

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const HANDLE = parseHandle("alice.example.com") as Handle;

const records = (...values: string[]): TxtOutcome => ({ kind: "records", records: values });
const NO_RECORD: TxtOutcome = { kind: "no_record" };
const DNS_DOWN: TxtOutcome = { kind: "unavailable" };
const body = (text: string): HttpOutcome => ({ kind: "response", status: 200, body: new TextEncoder().encode(text) });
const status = (code: number): HttpOutcome => ({ kind: "response", status: code, body: new Uint8Array() });
const HTTPS_DOWN: HttpOutcome = { kind: "unavailable" };

/** A stand-in network (DNS and handle domains are unmanaged dependencies, TE-1) recording each query. */
function network(txt: TxtOutcome, https: HttpOutcome) {
  const calls = { txt: [] as string[], https: [] as ({ url: string } & FetchRequest)[] };
  const net: IdentityNetwork = {
    txt: async (name) => {
      calls.txt.push(name);
      return txt;
    },
    get: async (url, request) => {
      calls.https.push({ url: url.href, ...request });
      return https;
    },
  };
  return { net, calls };
}

describe("resolveHandle", () => {
  test("dns_wins", async () => {
    const { net, calls } = network(records("v=spf1 -all", `did=${A}`), body(B));
    expect(await resolveHandle(net, HANDLE)).toEqual({ status: "found", did: A, via: "dns" });
    expect(calls.txt).toEqual(["_atproto.alice.example.com"]);
    expect(calls.https).toEqual([]);
  });

  test("same_did_twice_is_one_did", async () => {
    const { net } = network(records(`did=${A}`, `did=${A}`), status(404));
    expect(await resolveHandle(net, HANDLE)).toEqual({ status: "found", did: A, via: "dns" });
  });

  test("dns_conflict_falls_to_https", async () => {
    const { net, calls } = network(records(`did=${A}`, `did=${B}`), body(B));
    expect(await resolveHandle(net, HANDLE)).toEqual({ status: "found", did: B, via: "https" });
    expect(calls.https).toEqual([
      {
        url: "https://alice.example.com/.well-known/atproto-did",
        target: "public",
        maxBytes: 1024,
        accept: "text/plain",
      },
    ]);
  });

  test("garbage_txt_is_ignored", async () => {
    const { net } = network(records("did=garbage", "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", ` did=${A}`), body(B));
    expect(await resolveHandle(net, HANDLE)).toEqual({ status: "found", did: B, via: "https" });
  });

  test("https_only", async () => {
    const { net } = network(NO_RECORD, body(A));
    expect(await resolveHandle(net, HANDLE)).toEqual({ status: "found", did: A, via: "https" });
  });

  test("https_found_while_dns_unavailable", async () => {
    const { net } = network(DNS_DOWN, body(A));
    expect(await resolveHandle(net, HANDLE)).toEqual({ status: "found", did: A, via: "https" });
  });

  test("not_found", async () => {
    for (const https of [status(404), status(410), { kind: "no_such_host" } as const, { kind: "refused" } as const]) {
      const { net } = network(NO_RECORD, https);
      expect(await resolveHandle(net, HANDLE)).toEqual({ status: "not_found" });
    }
    const { net } = network(records(`did=${A}`, `did=${B}`), status(404));
    expect(await resolveHandle(net, HANDLE)).toEqual({ status: "not_found" });
  });

  test("unavailable_cases", async () => {
    const cases: [TxtOutcome, HttpOutcome][] = [
      [DNS_DOWN, status(404)],
      [NO_RECORD, HTTPS_DOWN],
      [DNS_DOWN, HTTPS_DOWN],
      [NO_RECORD, status(503)],
      [NO_RECORD, status(429)],
    ];
    for (const [txt, https] of cases) {
      const { net } = network(txt, https);
      expect(await resolveHandle(net, HANDLE)).toEqual({ status: "unavailable" });
    }
  });

  test("https_body_rules", async () => {
    const via = async (text: string | Uint8Array) => {
      const outcome: HttpOutcome =
        typeof text === "string" ? body(text) : { kind: "response", status: 200, body: text };
      return resolveHandle(network(NO_RECORD, outcome).net, HANDLE);
    };
    expect(await via(`${A}\n`)).toEqual({ status: "found", did: A, via: "https" });
    expect(await via(` \t${A}\r\n`)).toEqual({ status: "found", did: A, via: "https" });
    for (const bad of [`${A}\n${B}`, `<html>${A}</html>`, "", `did=${A}`, `${A} `]) {
      expect(await via(bad), bad).toEqual({ status: "not_found" });
    }
    expect(await via(new Uint8Array([0xff, 0x00]))).toEqual({ status: "not_found" });
    const other = await resolveHandle(
      network(NO_RECORD, { kind: "response", status: 201, body: new TextEncoder().encode(A) }).net,
      HANDLE,
    );
    expect(other).toEqual({ status: "not_found" });
  });

  test("dns_skipped_when_the_name_is_too_long", async () => {
    // `_atproto.` adds 9 characters, and DNS names stop at 253 (atproto handle spec, "DNS TXT Method").
    const long = parseHandle(`${"a.".repeat(120)}example.com`) as Handle;
    const { net, calls } = network(records(`did=${A}`), body(B));
    expect(await resolveHandle(net, long)).toEqual({ status: "found", did: B, via: "https" });
    expect(calls.txt).toEqual([]);
  });
});
