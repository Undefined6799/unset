// Node26.10 helper only. Pinned PLC0.0.1 follows upstream dev-env/src/plc.ts:
// Database.mock still invokes assureValidNextOp (signature/history validation).

import { createSocket } from "node:dgram"; // guard-allow: egress ADR0027 owned isolated DNS sentinel only
import { Resolver } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { createServer, request } from "node:http"; // guard-allow: egress ADR0027 fixed internal PDS/PLC/mail endpoints
import { createRequire } from "node:module";
import { connect } from "node:net"; // guard-allow: egress ADR0027 controlled owned isolation sentinels only
import { startMailbox } from "./mail.ts";

type Rpc = {
  kind: "native" | "mail" | "plc" | "deny";
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};
export type Reply = { status: number; headers: Record<string, string | string[]>; body: string };
const NATIVE =
  /^\/(?:account(?:\/[a-zA-Z0-9/_-]*)?|@atproto\/oauth-provider\/~api\/(?:sign-up|sign-in|sign-out|device-sessions|reset-password-request|reset-password-confirm|verify-email-request|verify-email-confirm|enable-email-otp))$/;
async function boundedRequest(
  host: string,
  port: number,
  path: string,
  method: string,
  headers: Record<string, string>,
  body: string,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path, method, headers, timeout: 8_000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (part: string) => {
        text += part;
        if (text.length > 2_097_152) req.destroy(new Error("fixture response limit"));
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers as Reply["headers"], body: text }),
      );
    });
    req.on("timeout", () => req.destroy(new Error("fixture request timeout")));
    req.on("error", () => reject(new Error("fixture request failed")));
    req.end(body);
  });
}
export async function executeRpc(input: Rpc): Promise<Reply> {
  if (
    !Number.isInteger(input.port) ||
    input.port < 1024 ||
    input.port > 65535 ||
    input.body.length > 65_536 ||
    !["GET", "POST"].includes(input.method)
  )
    throw new Error("invalid fixture request");
  if (input.kind === "native" && NATIVE.test(input.path))
    return boundedRequest(
      "pds",
      input.port,
      input.path,
      input.method,
      { ...input.headers, host: "pds.fixture.test" },
      input.body,
    );
  if (input.kind === "mail" && input.path === "/mail")
    return boundedRequest("127.0.0.1", 2590, "/mail", "POST", { "content-type": "application/json" }, input.body);
  if (input.kind === "plc" && /^\/did:plc:[a-z2-7]{24}$/.test(input.path))
    return boundedRequest("127.0.0.1", 2582, input.path, "GET", {}, "");
  if (input.kind === "deny" && /^172\.(?:1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}$/.test(input.path)) {
    const dns = createSocket("udp4");
    const dnsDenied = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        dns.close();
        resolve(true);
      }, 700);
      dns.on("error", () => {
        clearTimeout(timer);
        dns.close();
        resolve(true);
      });
      dns.on("message", () => {
        clearTimeout(timer);
        dns.close();
        resolve(false);
      });
      dns.send("fixture-probe", 1053, input.path);
    });
    const resolver = new Resolver({ timeout: 500, tries: 1 });
    let forwardingDenied = false;
    try {
      await resolver.resolve4("blocked.fixture.test");
    } catch {
      forwardingDenied = true;
    }
    const routes = readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1);
    const noDefaultRoute = routes.every((line) => line.trim().split(/\s+/)[1] !== "00000000");
    const denied =
      dnsDenied &&
      forwardingDenied &&
      noDefaultRoute &&
      (await refusesTcp(input.path, 2590)) &&
      (await refusesTcp(input.path, 1025)) &&
      (await refusesTcp("host.docker.internal", input.port));
    return { status: 200, headers: {}, body: JSON.stringify({ denied, dnsDenied, forwardingDenied, noDefaultRoute }) };
  }
  throw new Error("fixture target refused");
}
export async function refusesTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (denied: boolean) => {
      socket.destroy();
      resolve(denied);
    };
    socket.setTimeout(700, () => finish(true));
    socket.once("error", () => finish(true));
    socket.once("connect", () => finish(false));
  });
}
async function serve() {
  const plc = createRequire(import.meta.url)("/runtime/plc.cjs");
  const db = plc.Database.mock();
  const server = await plc.PlcServer.create({ db, port: 2582 });
  await server.start();
  const mailbox = await startMailbox(1025);
  // Controlled DNS sentinel; no recursion or forwarding, responds only to the fixture's probe.
  const dns = createSocket("udp4");
  dns.on("message", (message, sender) => {
    if (message.toString() === "fixture-probe") dns.send(message, sender.port, sender.address);
  });
  dns.bind(1053, "0.0.0.0");
  const control = createServer((req, res) => {
    let body = "";
    req.setTimeout(3_000, () => req.destroy());
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        if (req.method === "GET" && req.url === "/ready") {
          res.end("ready");
          return;
        }
        if (req.method !== "POST" || req.url !== "/mail") {
          res.writeHead(404).end();
          return;
        }
        const input = JSON.parse(body) as { recipient: string; purpose: string };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: mailbox.take(input.recipient, input.purpose) }));
      } catch {
        res.writeHead(400).end("fixture request refused");
      }
    });
  });
  control.listen(2590, "0.0.0.0");
  const close = () => {
    control.close();
    dns.close();
    void mailbox
      .close()
      .then(() => server.destroy())
      .then(() => process.exit(0));
  };
  process.once("SIGTERM", close);
}
if (process.argv[2] === "serve") await serve();
if (process.argv[2] === "rpc") {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 131_072) throw new Error("fixture request limit");
  }
  try {
    process.stdout.write(JSON.stringify(await executeRpc(JSON.parse(input) as Rpc)));
  } catch {
    process.stderr.write("fixture transport failed");
    process.exitCode = 1;
  }
}
