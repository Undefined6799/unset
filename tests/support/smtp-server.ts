// A small SMTP server over implicit TLS for tests (an unmanaged dependency, rule TE-1): a certificate for `localhost`
// made for the run by openssl, PLAIN login as `user`/`pass`, then MAIL, RCPT and DATA, each message recorded. The
// client's TLS check, login and message are the real ones; the test trusts the certificate it was handed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net"; // guard-allow: egress a type only, for the test server's port
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls"; // guard-allow: egress a loopback test server only

export type ReceivedMail = { auth: string; from: string; to: string; data: string };

export type TestSmtp = {
  readonly port: number;
  /** The server's certificate, PEM, for the client to trust (a `ca` option or NODE_EXTRA_CA_CERTS). */
  readonly cert: string;
  /** The certificate's path, for NODE_EXTRA_CA_CERTS. */
  readonly certPath: string;
  readonly received: ReceivedMail[];
  readonly close: () => Promise<void>;
};

/** A one-message-per-connection SMTP server on 127.0.0.1. `stall` accepts and never greets. */
export async function startTestSmtp(options: { stall?: boolean } = {}): Promise<TestSmtp> {
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
  const received: ReceivedMail[] = [];
  const open = new Set<{ destroy: () => void }>();
  const server = createServer({ cert, key }, (socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    socket.on("error", () => undefined);
    if (options.stall === true) return;
    const seen: ReceivedMail = { auth: "", from: "", to: "", data: "" };
    let inData = false;
    let buffer = "";
    const command = (line: string): string => {
      if (/^EHLO /i.test(line)) return "250-test\r\n250 AUTH PLAIN\r\n";
      if (/^AUTH PLAIN /i.test(line)) {
        seen.auth = Buffer.from(line.slice(11), "base64").toString("utf8");
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
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          seen.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push({ ...seen });
          socket.write("250 queued\r\n");
          continue;
        }
        const at = buffer.indexOf("\r\n");
        if (at < 0) return;
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const reply = command(line);
        if (/^QUIT$/i.test(line)) socket.end(reply);
        else socket.write(reply);
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    port: (server.address() as AddressInfo).port,
    cert,
    certPath,
    received,
    close: async () => {
      // A stalled connection would hold close open; the test is done with it.
      for (const socket of open) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
