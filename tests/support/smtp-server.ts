// A small SMTP server for tests, over implicit TLS or STARTTLS (an unmanaged dependency, rule TE-1): a certificate for
// `localhost` made for the run by openssl, PLAIN login as `user`/`pass`, then MAIL, RCPT and DATA, each message
// recorded. The client's TLS check, login and message are the real ones; the test trusts the certificate it was handed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { type AddressInfo, createServer as netServer, type Socket } from "node:net"; // guard-allow: egress loopback test

import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, TLSSocket } from "node:tls"; // guard-allow: egress a loopback test server only

export type ReceivedMail = { auth: string; from: string; to: string; data: string };

/** `implicit`: TLS from the first byte (smtps). `starttls`: plain, offers STARTTLS. `plain`: plain, offers no TLS. */
export type SmtpMode = "implicit" | "starttls" | "plain";

export type TestSmtp = {
  readonly port: number;
  /** The server's certificate, PEM, for the client to trust (a `ca` option or NODE_EXTRA_CA_CERTS). */
  readonly cert: string;
  /** The certificate's path, for NODE_EXTRA_CA_CERTS. */
  readonly certPath: string;
  readonly received: ReceivedMail[];
  /** Every AUTH line that arrived, decoded, and whether it came over TLS. */
  readonly logins: { readonly auth: string; readonly overTls: boolean }[];
  readonly close: () => Promise<void>;
};

/** One SMTP conversation on `socket`; after STARTTLS it goes on over the TLS socket wrapped around it. */
function converse(
  socket: Socket,
  mode: SmtpMode,
  tlsOptions: { cert: string; key: string },
  record: Pick<TestSmtp, "received" | "logins">,
  slowMs: number,
): void {
  const seen: ReceivedMail = { auth: "", from: "", to: "", data: "" };
  let current: Socket = socket;
  let overTls = mode === "implicit";
  let inData = false;
  let buffer = "";
  // Every reply waits `slowMs`: a server that keeps answering, each answer inside the client's idle timeout.
  const reply = (text: string, end = false): void => {
    const out = current;
    const go = (): void => {
      if (out.destroyed) return;
      if (end) out.end(text);
      else out.write(text);
    };
    if (slowMs > 0) setTimeout(go, slowMs);
    else go();
  };
  const command = (line: string): string => {
    if (/^EHLO /i.test(line)) {
      return mode === "starttls" && !overTls
        ? "250-test\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n"
        : "250-test\r\n250 AUTH PLAIN\r\n";
    }
    if (/^AUTH PLAIN /i.test(line)) {
      seen.auth = Buffer.from(line.slice(11), "base64").toString("utf8");
      record.logins.push({ auth: seen.auth, overTls });
      return seen.auth === "\0user\0pass" ? "235 ok\r\n" : "535 no\r\n";
    }
    if (/^MAIL FROM:/i.test(line)) seen.from = line.slice(10);
    else if (/^RCPT TO:/i.test(line)) seen.to = line.slice(8);
    else if (/^DATA$/i.test(line)) {
      inData = true;
      return "354 go\r\n";
    } else if (/^QUIT$/i.test(line)) return "221 bye\r\n";
    else return "502 no\r\n";
    return "250 ok\r\n";
  };
  const onData = (chunk: Buffer): void => {
    buffer += chunk.toString("utf8");
    for (;;) {
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        seen.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        record.received.push({ ...seen });
        reply("250 queued\r\n");
        continue;
      }
      const at = buffer.indexOf("\r\n");
      if (at < 0) return;
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (/^STARTTLS$/i.test(line) && mode === "starttls" && !overTls) {
        current.write("220 go ahead\r\n");
        socket.removeListener("data", onData);
        const secured = new TLSSocket(socket, { isServer: true, ...tlsOptions });
        secured.on("error", () => undefined);
        secured.on("data", onData);
        current = secured;
        overTls = true;
        buffer = "";
        return;
      }
      reply(command(line), /^QUIT$/i.test(line));
    }
  };
  socket.on("data", onData);
  reply("220 test ESMTP\r\n");
}

/**
 * A one-message-per-connection SMTP server on 127.0.0.1. `stall` accepts and never greets; `slowMs` delays every
 * reply by that many milliseconds.
 */
export async function startTestSmtp(
  options: { stall?: boolean; mode?: SmtpMode; slowMs?: number } = {},
): Promise<TestSmtp> {
  const mode = options.mode ?? "implicit";
  const dir = mkdtempSync(join(tmpdir(), "smtp-test-"));
  const certPath = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1"],
      ...["-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"],
      ...["-keyout", join(dir, "key.pem"), "-out", certPath],
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(certPath, "utf8");
  const key = readFileSync(join(dir, "key.pem"), "utf8");
  const record = { received: [] as ReceivedMail[], logins: [] as { auth: string; overTls: boolean }[] };
  const open = new Set<Socket>();
  const onConnection = (socket: Socket): void => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    socket.on("error", () => undefined);
    if (options.stall !== true) converse(socket, mode, { cert, key }, record, options.slowMs ?? 0);
  };
  const server = mode === "implicit" ? createServer({ cert, key }, onConnection) : netServer(onConnection);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    port: (server.address() as AddressInfo).port,
    cert,
    certPath,
    ...record,
    close: async () => {
      // A stalled connection would hold close open; the test is done with it.
      for (const socket of open) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
