// Fixture-only SMTP subset: RFC5321 §4.1/4.5.2. Nodemailer6.10.1 smtp-connection:1314
// upgrades only when STARTTLS is advertised; this isolated sink advertises neither TLS nor AUTH.
import { createServer, type Socket } from "node:net"; // guard-allow: egress ADR0027 isolated SMTP listener; no outbound transport

const LIMIT = 262_144;
const RECIPIENT = /^[a-z0-9-]{1,64}@fixture\.test$/;
const PURPOSES = new Set(["Email Confirmation", "Password Reset Requested", "Sign-in Confirmation"]);

function splitPart(mime: string): [string, string] {
  const at = mime.indexOf("\r\n\r\n");
  if (at < 0) throw new Error("invalid fixture MIME");
  return [mime.slice(0, at).replace(/\r\n[ \t]+/g, " "), mime.slice(at + 4)];
}
function header(headers: string, name: string): string {
  return new RegExp(`^${name}:\\s*(.*)$`, "im").exec(headers)?.[1]?.trim() ?? "";
}
function htmlParts(mime: string, depth = 0): string[] {
  if (depth > 4 || mime.length > LIMIT) throw new Error("fixture MIME limit");
  const [headers, body] = splitPart(mime);
  const type = header(headers, "content-type");
  if (/^multipart\//i.test(type)) {
    const boundary = /boundary=(?:"([^"\r\n]{1,100})"|([^;\s]{1,100}))/i.exec(type);
    const marker = boundary?.[1] ?? boundary?.[2];
    if (!marker) throw new Error("invalid fixture MIME boundary");
    return body
      .split(`--${marker}`)
      .slice(1)
      .filter((part) => !part.startsWith("--"))
      .flatMap((part) => htmlParts(part.replace(/^\r\n/, ""), depth + 1));
  }
  if (!/^text\/html(?:;|$)/i.test(type)) return [];
  const encoding = header(headers, "content-transfer-encoding").toLowerCase();
  if (encoding === "base64") return [Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8")];
  if (encoding === "quoted-printable") {
    const raw = body
      .replace(/=\r\n/g, "")
      .replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    return [Buffer.from(raw, "latin1").toString("utf8")];
  }
  if (encoding && !["7bit", "8bit", "binary"].includes(encoding)) throw new Error("unsupported fixture MIME encoding");
  return [body];
}
/** Only native delivered HTML codes for the exact expected subject; never log the MIME/code. */
export function codeFromMime(mime: string, purpose: string): string {
  if (mime.length > LIMIT || !PURPOSES.has(purpose) || header(splitPart(mime)[0], "subject") !== purpose) {
    throw new Error("fixture mail purpose mismatch");
  }
  const codes = htmlParts(mime).flatMap((html) =>
    [...html.matchAll(/<code(?:\s[^>]*)?>([^<]*)<\/code>/gi)].map((match) => match[1]?.trim()),
  );
  if (codes.length !== 1 || !/^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(codes[0] ?? ""))
    throw new Error("ambiguous fixture mail code");
  return codes[0] as string;
}

/** Bounded in-memory capture; only synthetic recipients can be accepted, with no outbound transport. */
export async function startMailbox(port: number) {
  const messages: { recipients: string[]; mime: string }[] = [];
  const clients = new Set<Socket>();
  const server = createServer((socket) => {
    if (clients.size >= 4) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    socket.setEncoding("utf8");
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("close", () => clients.delete(socket));
    socket.write("220 fixture SMTP\r\n");
    let buffer = "",
      data: string[] | null = null,
      recipients: string[] = [],
      sender = false,
      bytes = 0;
    function acceptRecipient(line: string) {
      const recipient = /^RCPT TO:<([^<>]+)>$/i.exec(line)?.[1];
      if (sender && recipient && RECIPIENT.test(recipient) && recipients.length < 4) {
        recipients.push(recipient);
        socket.write("250 recipient\r\n");
      } else socket.write("550 relay refused\r\n");
    }
    function command(line: string) {
      const verb = line.split(" ")[0]?.toUpperCase();
      switch (verb) {
        case "EHLO":
        case "HELO":
        case "NOOP":
          socket.write("250 fixture\r\n");
          return;
        case "RSET":
          recipients = [];
          sender = false;
          socket.write("250 reset\r\n");
          return;
        case "MAIL":
          if (!/^MAIL FROM:<[^<>\r\n]{0,200}>$/i.test(line)) break;
          sender = true;
          recipients = [];
          socket.write("250 sender\r\n");
          return;
        case "RCPT":
          acceptRecipient(line);
          return;
        case "DATA":
          if (!sender || recipients.length === 0) break;
          data = [];
          socket.write("354 end with dot\r\n");
          return;
        case "QUIT":
          socket.end("221 bye\r\n");
          return;
      }
      socket.write("503 unsupported fixture command\r\n");
    }
    function consumeLine(line: string) {
      if (data === null) {
        command(line);
        return;
      }
      if (line !== ".") {
        data.push(line.replace(/^\.\./, "."));
        return;
      }
      if (messages.length >= 32) {
        socket.end("452 fixture mailbox full\r\n");
        return;
      }
      messages.push({ recipients, mime: data.join("\r\n") });
      data = null;
      recipients = [];
      sender = false;
      socket.write("250 captured\r\n");
    }
    socket.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > LIMIT) {
        socket.end("552 fixture message limit\r\n");
        return;
      }
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        consumeLine(line);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  return {
    port: (server.address() as { port: number }).port,
    take(recipient: string, purpose: string): string | null {
      if (!RECIPIENT.test(recipient) || !PURPOSES.has(purpose)) throw new Error("invalid fixture mailbox query");
      const index = messages.findIndex(
        (mail) => mail.recipients.includes(recipient) && header(splitPart(mail.mime)[0], "subject") === purpose,
      );
      if (index < 0) return null;
      const [message] = messages.splice(index, 1);
      return codeFromMime(message?.mime ?? "", purpose);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        messages.length = 0;
        for (const client of clients) client.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
