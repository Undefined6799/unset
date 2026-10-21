import { connect } from "node:net";
import { afterEach, expect, test } from "vitest";
import { codeFromMime, startMailbox } from "../../integration/pds-ui/mail.ts";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("decodes native codes from MIME alternatives and refuses wrong purpose or ambiguity", () => {
  const mime =
    'Subject: Email Confirmation\r\nContent-Type: multipart/alternative; boundary="x"\r\n\r\n--x\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<code>ABCDE=\r\n-23456</code>\r\n--x--';
  expect(codeFromMime(mime, "Email Confirmation")).toBe("ABCDE-23456");
  expect(() => codeFromMime(mime, "Sign-in Confirmation")).toThrow("mail purpose");
  expect(() => codeFromMime(mime.replace("</code>", "</code><code>ABCDE-23456</code>"), "Email Confirmation")).toThrow(
    "ambiguous",
  );
  const base64 = `Subject: Sign-in Confirmation\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from("<code>ABCDE-23456</code>").toString("base64")}`;
  expect(codeFromMime(base64, "Sign-in Confirmation")).toBe("ABCDE-23456");
});

test("captures SMTP DATA by recipient, rejects relay, and bounds messages", async () => {
  const mailbox = await startMailbox(0);
  closers.push(mailbox.close);
  const socket = connect(mailbox.port, "127.0.0.1");
  socket.setEncoding("utf8");
  let replies = "";
  socket.on("data", (part) => {
    replies += part;
  });
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  socket.write(
    "EHLO test\r\nMAIL FROM:<sender@fixture.test>\r\nRCPT TO:<person@example.com>\r\nRCPT TO:<a@fixture.test>\r\nDATA\r\nSubject: Email Confirmation\r\nContent-Type: text/html\r\n\r\n<code>ABCDE-23456</code>\r\n..dot\r\n.\r\nQUIT\r\n",
  );
  await new Promise<void>((resolve) => socket.once("close", resolve));
  expect(replies).toContain("550");
  expect(mailbox.take("b@fixture.test", "Email Confirmation")).toBeNull();
  expect(mailbox.take("a@fixture.test", "Email Confirmation")).toBe("ABCDE-23456");
  expect(mailbox.take("a@fixture.test", "Email Confirmation")).toBeNull();
  const oversized = connect(mailbox.port, "127.0.0.1");
  await new Promise<void>((resolve) => oversized.once("connect", resolve));
  oversized.write("x".repeat(262_145));
  oversized.resume();
  await new Promise<void>((resolve) => oversized.once("close", resolve));
});
