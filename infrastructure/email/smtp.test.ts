import { describe, expect, it } from "vitest";
import { parseSmtpsUrl } from "./smtp.ts";

describe("parseSmtpsUrl", () => {
  it("reads an smtps URL, with 465 as the default port and the key decoded", () => {
    expect(parseSmtpsUrl("smtps://resend:re_a%2Fb@smtp.example.test")).toEqual({
      host: "smtp.example.test",
      port: 465,
      user: "resend",
      pass: "re_a/b",
    });
    expect(parseSmtpsUrl("smtps://u:p@smtp.example.test:2465")?.port).toBe(2465);
  });

  it.each([
    "smtp://u:p@smtp.example.test:587",
    "smtps://smtp.example.test",
    "smtps://u@smtp.example.test",
    "smtps://u:p@smtp.example.test/path",
    "smtps://u:p@smtp.example.test?x=1",
    "not a url",
  ])("refuses %s", (raw) => {
    expect(parseSmtpsUrl(raw)).toBeNull();
  });
});
