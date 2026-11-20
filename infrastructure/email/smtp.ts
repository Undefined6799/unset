// Outbound mail over SMTP with implicit TLS (ADR 0080). The one adapter that imports nodemailer (dependency-cruiser
// vendor-sdk-one-adapter). Read for nodemailer 10.5.0: dist/cjs/smtp-transport/index.d.ts (host, port, secure, auth),
// dist/cjs/smtp-connection/index.d.ts (connectionTimeout, greetingTimeout, socketTimeout; `secure` opens TLS before
// the greeting) and dist/cjs/mailer/index.d.ts (disableFileAccess, disableUrlAccess). The server is a fixed host from
// config, never from a request, so this is not caller-influenced egress (CLAUDE.md "Egress").
import { createTransport } from "nodemailer";

/** Where mail goes: an `smtps:` URL's parts. The password is the provider's key. */
export type MailServer = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
};

/**
 * `smtps://user:pass@host:port` (port 465 when absent), or null. Only implicit TLS: a plain `smtp:` URL would send the
 * key before any upgrade, so it is refused. No path, query or fragment.
 */
export function parseSmtpsUrl(raw: string): MailServer | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "smtps:" || url.hostname === "" || url.username === "" || url.password === "") return null;
  if (url.pathname !== "" || url.search !== "" || url.hash !== "") return null;
  const port = url.port === "" ? 465 : Number(url.port);
  try {
    return {
      host: url.hostname,
      port,
      user: decodeURIComponent(url.username),
      pass: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

/** One plain-text message. Every address has been parsed by its caller; none holds a line break. */
export type Mail = {
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text: string;
};

export type Mailer = {
  /** `sent` once the server accepted the message, `failed` on any refusal, error or the deadline. Never throws. */
  readonly send: (mail: Mail, deadline: AbortSignal) => Promise<"sent" | "failed">;
};

export type MailerOptions = {
  readonly server: MailServer;
  readonly from: string;
  /** Each of the connect, greeting and idle timeouts; the request's deadline still bounds the whole send. */
  readonly timeoutMs: number;
  /** Extra trust anchors, PEM (tests' own server); production trusts the system store only. */
  readonly ca?: string;
};

export function createSmtpMailer(options: MailerOptions): Mailer {
  const { server } = options;
  const transport = createTransport({
    host: server.host,
    port: server.port,
    secure: true,
    auth: { user: server.user, pass: server.pass },
    connectionTimeout: options.timeoutMs,
    greetingTimeout: options.timeoutMs,
    socketTimeout: options.timeoutMs,
    tls: options.ca === undefined ? { minVersion: "TLSv1.2" } : { minVersion: "TLSv1.2", ca: options.ca },
    // Nothing a message names is ever read from disk or fetched, and nodemailer writes no log.
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
  });
  return {
    send: async (mail, deadline) => {
      if (deadline.aborted) return "failed";
      const aborted = new Promise<"failed">((resolve) =>
        deadline.addEventListener("abort", () => resolve("failed"), { once: true }),
      );
      const sent = transport
        .sendMail({ from: options.from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text })
        .then((info): "sent" | "failed" => (info.accepted.length > 0 && info.rejected.length === 0 ? "sent" : "failed"))
        .catch((): "failed" => "failed");
      return Promise.race([sent, aborted]);
    },
  };
}
