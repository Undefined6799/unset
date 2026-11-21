// The door's Node listener (build step 6): turns an IncomingMessage into a fetch Request and the door's Response back.
// The Request's URL is the door's own origin plus the request target, so the Host header (which the door checks
// against HTTP_ALLOWED_HOSTS itself) never chooses an origin. A body must declare its length and stay under the cap;
// otherwise the door never runs (413, or 411 with no length). Node 26 docs: http.IncomingMessage, Headers#getSetCookie.
import type { IncomingMessage, Server, ServerResponse } from "node:http"; // guard-allow: egress inbound listener types only

export type DoorHandler = (request: Request, peer: string | undefined) => Promise<Response>;

function headersOf(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  return headers;
}

/** The body, or the status that refuses it: read only up to `cap` bytes. */
async function bodyOf(message: IncomingMessage, cap: number): Promise<Buffer | 411 | 413> {
  const declared = message.headers["content-length"];
  if (declared === undefined || !/^\d{1,9}$/.test(declared)) return 411;
  if (Number(declared) > cap) return 413;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of message as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > cap) return 413;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function write(response: Response, out: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  const body = Buffer.from(await response.arrayBuffer());
  out.writeHead(response.status, { ...headers, "content-length": String(body.length) });
  out.end(body);
}

const refusal = (status: 411 | 413) =>
  new Response(null, { status, headers: { "cache-control": "no-store", connection: "close" } });

export function createListener(origin: string, bodyCap: number, door: DoorHandler) {
  return (message: IncomingMessage, out: ServerResponse): void => {
    const run = async () => {
      const method = message.method ?? "GET";
      const target = message.url?.startsWith("/") ? message.url : "/";
      const init: RequestInit = { method, headers: headersOf(message) };
      if (method !== "GET" && method !== "HEAD") {
        const body = await bodyOf(message, bodyCap);
        if (typeof body === "number") return write(refusal(body), out);
        init.body = body;
      }
      return write(await door(new Request(`${origin}${target}`, init), message.socket.remoteAddress), out);
    };
    run().catch(() => out.destroy());
  };
}

/**
 * Starts `server` on `port` at `address` only. With no host, Node binds every address the container holds (Node 26
 * docs, net.Server.listen: "the server will accept connections on the unspecified IPv6 address (::) ... or the
 * unspecified IPv4 address (0.0.0.0)"), so every network the door joins would reach the listener.
 */
export function listenOn(server: Server, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
