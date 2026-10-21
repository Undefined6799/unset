// ADR0027 diagnostic transport only: fixed owned helper/native routes; no public endpoint.
import { spawn } from "node:child_process";
import { createServer } from "node:http"; // guard-allow: egress ADR0027 test-only loopback relay/sentinel
import type { Reply } from "./helper.ts";

const CALL_MS = 10_000;
export function rpc(container: string, input: object): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "node", "/runtime/helper.ts", "rpc"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill("SIGKILL");
    }, CALL_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      output += part;
      if (output.length > 2_200_000) {
        failed = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.resume(); // Never retain native inputs/errors/mail/credentials.
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("fixture transport unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || failed) {
        reject(new Error("fixture transport failed"));
        return;
      }
      try {
        resolve(JSON.parse(output) as Reply);
      } catch {
        reject(new Error("fixture transport invalid"));
      }
    });
    child.stdin.on("error", () => child.kill("SIGKILL"));
    child.stdin.end(JSON.stringify(input));
  });
}
export async function startTransport(helper: string) {
  const relay = createServer();
  await new Promise<void>((resolve, reject) => {
    relay.once("error", reject);
    relay.listen(0, "127.0.0.1", resolve);
  });
  const port = (relay.address() as { port: number }).port;
  const send = (path: string, method: string, headers: Record<string, string>, body: string) =>
    rpc(helper, { kind: "native", port, path, method, headers, body });
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
  return {
    port,
    send,
    close() {
      relay.closeAllConnections();
      relay.close();
    },
  };
}
