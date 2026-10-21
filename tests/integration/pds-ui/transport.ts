// ADR0027 diagnostic transport only: fixed owned helper/native routes; no public endpoint.
import { createServer } from "node:http"; // guard-allow: egress ADR0027 test-only loopback relay/sentinel
import type { FixtureLifetime } from "./fixture-lifetime.ts";
import type { Reply } from "./helper.ts";

const CALL_MS = 10_000;
export async function rpc(
  lifetime: FixtureLifetime,
  container: string,
  input: object,
  signal = lifetime.signal,
): Promise<Reply> {
  const result = await lifetime.command(
    "docker",
    ["exec", "-i", container, "node", "/runtime/helper.ts", "rpc"],
    CALL_MS,
    JSON.stringify(input),
    signal,
  );
  if (result.code !== 0 || result.out.length > 2_200_000) throw new Error("fixture transport failed");
  try {
    return JSON.parse(result.out) as Reply;
  } catch {
    throw new Error("fixture transport invalid");
  }
}
export async function startTransport(helper: string, lifetime: FixtureLifetime) {
  lifetime.check();
  const relay = createServer();
  lifetime.defer(
    () =>
      new Promise<void>((resolve, reject) => {
        relay.closeAllConnections();
        relay.close((error: NodeJS.ErrnoException | undefined) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(new Error("fixture relay cleanup failed"));
          else resolve();
        });
      }),
  );
  await lifetime.track(
    (signal) =>
      new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error("fixture relay canceled"));
        signal.addEventListener("abort", abort, { once: true });
        relay.once("error", reject);
        relay.listen({ port: 0, host: "127.0.0.1", signal }, () => {
          signal.removeEventListener("abort", abort);
          resolve();
        });
      }),
  );
  const port = (relay.address() as { port: number }).port;
  const send = (
    path: string,
    method: string,
    headers: Record<string, string>,
    body: string,
    signal = lifetime.signal,
  ) => rpc(lifetime, helper, { kind: "native", port, path, method, headers, body }, signal);
  relay.on("request", (req, res) => {
    let body = "";
    req.setTimeout(CALL_MS, () => req.destroy());
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 65_536) req.destroy();
    });
    req.on("end", () => {
      if (req.headers.host !== `localhost:${port}` || !["GET", "POST"].includes(req.method ?? "")) {
        res.writeHead(400).end();
        return;
      }
      const headers: Record<string, string> = {};
      for (const name of [
        "origin",
        "referer",
        "cookie",
        "x-csrf-token",
        "sec-fetch-mode",
        "sec-fetch-site",
        "sec-fetch-dest",
        "user-agent",
        "content-type",
      ]) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      void send(req.url ?? "", req.method ?? "", headers, body)
        .then((reply) => {
          res.writeHead(reply.status, reply.headers);
          res.end(reply.body);
        })
        .catch(() => {
          res.writeHead(502).end("fixture transport failed");
        });
    });
  });
  return { port, send };
}
