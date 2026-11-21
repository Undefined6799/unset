// The door's Node listener (build step 6): an IncomingMessage becomes a fetch Request on the door's own origin, never
// one the Host header names; a body over the cap or with no declared length is refused before the door runs; every
// Set-Cookie line the door wrote reaches the client.
import { createServer, request as send } from "node:http"; // guard-allow: egress test client to its own loopback listener
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createListener, listenOn } from "./listener.ts";

const seen: { url: string; method: string; body: string; peer: string | undefined }[] = [];
const server = createServer(
  createListener("https://unset.cc", 64, async (request, peer) => {
    seen.push({ url: request.url, method: request.method, body: await request.text(), peer });
    const headers = new Headers({ "content-type": "text/plain" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");
    return new Response("done", { status: 201, headers });
  }),
);
let port = 0;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function call(method: string, path: string, body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; cookies: string[]; text: string }>((resolve, reject) => {
    const req = send(
      { host: "127.0.0.1", port, method, path, headers: { host: "evil.example", ...headers } },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, cookies: res.headers["set-cookie"] ?? [], text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("door listener", () => {
  test("door.listener_origin: the Request is on the door's origin whatever Host says, with path and query", async () => {
    const res = await call("GET", "/sign-in?return=%2F");
    expect(res.status).toBe(201);
    expect(seen.at(-1)).toMatchObject({ url: "https://unset.cc/sign-in?return=%2F", method: "GET", peer: "127.0.0.1" });
    expect(res.cookies).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  test("door.listener_body: a POST body under the cap reaches the door", async () => {
    await call("POST", "/sign-in/redeem", '{"a":1}', { "content-type": "application/json" });
    expect(seen.at(-1)).toMatchObject({ method: "POST", body: '{"a":1}' });
  });

  test("door.listener_cap: a body over the cap is 413 and the door never runs", async () => {
    const before = seen.length;
    const res = await call("POST", "/sign-in/redeem", "x".repeat(65));
    expect(res.status).toBe(413);
    expect(seen.length).toBe(before);
  });

  test("door.listener_chunked: a body with no declared length is 411", async () => {
    const before = seen.length;
    const res = await call("POST", "/sign-in/redeem", "x", { "transfer-encoding": "chunked" });
    expect(res.status).toBe(411);
    expect(seen.length).toBe(before);
  });
});

describe("listenOn", () => {
  test("listener.binds_one_address: answers on its address and refuses the same port on another", async () => {
    // Linux routes all of 127.0.0.0/8 to loopback, so two addresses stand in for two networks.
    const bound = createServer((_req, res) => res.end("ok"));
    await listenOn(bound, 0, "127.0.0.2");
    const { address, port: at } = bound.address() as AddressInfo;
    try {
      expect(address).toBe("127.0.0.2");
      const reach = (host: string) =>
        new Promise<string>((resolve) => {
          const req = send({ host, port: at, path: "/" }, (res) => resolve(String(res.statusCode)));
          req.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "error"));
          req.end();
        });
      expect(await reach("127.0.0.2")).toBe("200");
      expect(await reach("127.0.0.1")).toBe("ECONNREFUSED");
    } finally {
      await new Promise<void>((resolve) => bound.close(() => resolve()));
    }
  });
});
