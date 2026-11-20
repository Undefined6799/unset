import { describe, expect, it } from "vitest";
import { parseSmtpUrl } from "./smtp.ts";

describe("parseSmtpUrl", () => {
  it("reads an smtps URL, with 465 as the default port and the key decoded", () => {
    expect(parseSmtpUrl("smtps://resend:re_a%2Fb@smtp.example.test")).toEqual({
      host: "smtp.example.test",
      port: 465,
      implicitTls: true,
      user: "resend",
      pass: "re_a/b",
    });
    expect(parseSmtpUrl("smtps://u:p@smtp.example.test:2465")?.port).toBe(2465);
  });

  it("reads an smtp URL as STARTTLS required, with 587 as the default port", () => {
    expect(parseSmtpUrl("smtp://u:p@smtp.example.test")).toMatchObject({ port: 587, implicitTls: false });
  });

  it.each([
    "http://u:p@smtp.example.test",
    "smtps://smtp.example.test",
    "smtps://u@smtp.example.test",
    "smtps://u:p@smtp.example.test/path",
    "smtps://u:p@smtp.example.test?x=1",
    "not a url",
  ])("refuses %s", (raw) => {
    expect(parseSmtpUrl(raw)).toBeNull();
  });
});
