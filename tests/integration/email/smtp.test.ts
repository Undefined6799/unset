// P2.10r (ADR 0080): the SMTP adapter against a real TLS socket (tests/support/smtp-server.ts, rule TE-1), so the
// client's TLS check, login and message are the real ones.
import { createSmtpMailer } from "@unset/infrastructure-email";
import { describe, expect, it } from "vitest";
import { startTestSmtp } from "../../support/smtp-server.ts";

const MAIL = { to: "owner@example.test", replyTo: "visitor@example.test", subject: "Invite request", text: "Hello" };

function mailer(port: number, options: { pass?: string; ca?: string } = {}) {
  return createSmtpMailer({
    server: { host: "localhost", port, user: "user", pass: options.pass ?? "pass" },
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
});
