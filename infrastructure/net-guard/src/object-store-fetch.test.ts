// The object store's fetch (ADR 0088): one place sets how much a put may send and an answer may bring, so no process
// can read the store with net-guard's default 1 MiB answer cap. That default is what broke a picture's main version
// over 1,048,576 bytes at web's publish step before P2.19f (case `store.default_cap_was_the_bug`).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { guardedFetch, objectStoreFetch } from "./libraryFetch.ts";
import { OBJECT_STORE_BYTES, objectStore } from "./policies.ts";
import { type FakeServer, fakeResolver, httpServer, loopbackDial } from "./remote.fake.ts";
import { createNetGuardWith } from "./request.ts";
import { NetGuardError } from "./resolve.ts";

const ORIGIN = "http://objects:8333";
const MiB = 1024 * 1024;
let store: FakeServer;
/** Answers a GET for `/<n>` with n bytes, and reads a PUT's body whole. */
beforeAll(async () => {
  store = await httpServer((req, res) => {
    req.resume();
    req.on("end", () => res.end(req.method === "GET" ? Buffer.alloc(Number(req.url?.slice(1))) : "ok"));
  });
});
afterAll(() => store.close());

const guard = () =>
  createNetGuardWith(
    { internalHosts: [], allowLoopback: false, commit: "c".repeat(40) },
    { lookup: fakeResolver({ objects: ["172.20.0.9"] }).lookup, ...loopbackDial(store.port).hooks },
  );

async function read(fetch: typeof globalThis.fetch, bytes: number): Promise<number | string> {
  try {
    return (await (await fetch(`${ORIGIN}/${bytes}`)).arrayBuffer()).byteLength;
  } catch (error) {
    const cause = error instanceof NetGuardError ? error : (error as { cause?: unknown }).cause;
    return cause instanceof NetGuardError ? cause.code : String(error);
  }
}

describe("object store fetch", () => {
  test("store.default_cap_was_the_bug: without its own cap a 2,000,000-byte main version could not be read", async () => {
    expect(await read(guardedFetch(guard(), objectStore(ORIGIN)), 2_000_000)).toBe("egress.too_large");
  });

  test("store.answer_cap: a 5,000,000-byte main version is read; one byte past 5 MiB is refused", async () => {
    expect(OBJECT_STORE_BYTES).toBe(5 * MiB);
    const fetch = objectStoreFetch(guard(), ORIGIN);
    expect(await read(fetch, 5_000_000)).toBe(5_000_000);
    expect(await read(fetch, 5 * MiB)).toBe(5 * MiB);
    expect(await read(fetch, 5 * MiB + 1)).toBe("egress.too_large");
  });

  test("store.put_cap: a 5,000,000-byte main version is stored; one byte past 5 MiB is refused", async () => {
    const fetch = objectStoreFetch(guard(), ORIGIN);
    const put = async (bytes: number) => {
      try {
        // The store is plain http inside the stack (objectStore admits only its one private origin).
        const request = new Request(new URL("/k", ORIGIN), { method: "PUT", body: new Uint8Array(bytes) });
        return (await fetch(request)).status;
      } catch (error) {
        const cause = error instanceof NetGuardError ? error : (error as { cause?: unknown }).cause;
        return cause instanceof NetGuardError ? cause.code : String(error);
      }
    };
    expect(await put(5_000_000)).toBe(200);
    expect(await put(5 * MiB + 1)).toBe("egress.too_large");
  });
});
