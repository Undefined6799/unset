// P2.10r (ADR 0080): the SMTP adapter against a real TLS socket (tests/support/smtp-server.ts, rule TE-1), so the
// client's TLS check, login and message are the real ones.
import { createSmtpMailer } from "@unset/infrastructure-email";
import { describe, expect, it } from "vitest";
import { startTestSmtp } from "../../support/smtp-server.ts";

const MAIL = { to: "owner@example.test", replyTo: "visitor@example.test", subject: "Invite request", text: "Hello" };

function mailer(port: number, options: { pass?: string; ca?: string; implicitTls?: boolean } = {}) {
  return createSmtpMailer({
    server: {
      host: "localhost",
      port,
      implicitTls: options.implicitTls ?? true,
      user: "user",
      pass: options.pass ?? "pass",
    },
    from: "noreply@example.test",
    timeoutMs: 2000,
    ...(options.ca === undefined ? {} : { ca: options.ca }),
  });
}

describe("createSmtpMailer", () => {
  it("logs in over TLS and sends the message to its one recipient, with the reply address", async () => {
    const smtp = await startTestSmtp();
    try {
      expect(await mailer(smtp.port, { ca: smtp.cert }).send(MAIL, AbortSignal.timeout(5000))).toBe("sent");
      expect(smtp.received).toHaveLength(1);
      const [got] = smtp.received;
      expect(got?.from).toBe("<noreply@example.test>");
      expect(got?.to).toBe("<owner@example.test>");
      expect(got?.data).toMatch(/^Reply-To: visitor@example\.test$/m);
      expect(got?.data).toMatch(/^Subject: Invite request$/m);
      expect(got?.data).toMatch(/\r\n\r\nHello$/);
    } finally {
      await smtp.close();
    }
  });

  it("reports failed, and sends nothing, when the login is refused", async () => {
    const smtp = await startTestSmtp();
    try {
      const wrong = mailer(smtp.port, { pass: "wrong", ca: smtp.cert });
      expect(await wrong.send(MAIL, AbortSignal.timeout(5000))).toBe("failed");
      expect(smtp.received).toHaveLength(0);
    } finally {
      await smtp.close();
    }
  });

  it("reports failed when the server's certificate is not trusted", async () => {
    const smtp = await startTestSmtp();
    try {
      expect(await mailer(smtp.port).send(MAIL, AbortSignal.timeout(5000))).toBe("failed");
      expect(smtp.received).toHaveLength(0);
    } finally {
      await smtp.close();
    }
  });

  it("upgrades with STARTTLS before the login when the URL is smtp", async () => {
    const smtp = await startTestSmtp({ mode: "starttls" });
    try {
      const starttls = mailer(smtp.port, { ca: smtp.cert, implicitTls: false });
      expect(await starttls.send(MAIL, AbortSignal.timeout(5000))).toBe("sent");
      expect(smtp.logins).toEqual([{ auth: "\0user\0pass", overTls: true }]);
      expect(smtp.received).toHaveLength(1);
    } finally {
      await smtp.close();
    }
  });

  it("never sends the key in clear: a server without STARTTLS gets no login and no mail", async () => {
    const smtp = await startTestSmtp({ mode: "plain" });
    try {
      const starttls = mailer(smtp.port, { ca: smtp.cert, implicitTls: false });
      expect(await starttls.send(MAIL, AbortSignal.timeout(5000))).toBe("failed");
      expect(smtp.logins).toEqual([]);
      expect(smtp.received).toHaveLength(0);
    } finally {
      await smtp.close();
    }
  });

  it("reports failed when the request's deadline ends first", async () => {
    const smtp = await startTestSmtp({ stall: true });
    try {
      const started = performance.now();
      expect(await mailer(smtp.port, { ca: smtp.cert }).send(MAIL, AbortSignal.timeout(200))).toBe("failed");
      expect(performance.now() - started).toBeLessThan(1500);
    } finally {
      await smtp.close();
    }
  });

  it("stops the conversation at the deadline, so a slow server never gets the message", async () => {
    // Each reply comes inside the idle timeout, so only the deadline can end the send. Were the send left running
    // after "failed", the message would land later, and the caller, told it failed, would let the visitor ask again.
    const smtp = await startTestSmtp({ slowMs: 150 });
    try {
      expect(await mailer(smtp.port, { ca: smtp.cert }).send(MAIL, AbortSignal.timeout(400))).toBe("failed");
      await new Promise((done) => setTimeout(done, 1500));
      expect(smtp.received).toHaveLength(0);
    } finally {
      await smtp.close();
    }
  });
});
