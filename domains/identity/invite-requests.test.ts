import { describe, expect, it } from "vitest";
import { type InviteRequestPorts, parseRequesterEmail, type RequesterEmail, requestInvite } from "./invite-requests.ts";

describe("parseRequesterEmail", () => {
  it("accepts an ordinary address, trimmed, with its domain lower-cased", () => {
    expect(parseRequesterEmail("  Sam.Lee+unset@Example.CA ")).toBe("Sam.Lee+unset@example.ca");
    expect(parseRequesterEmail("a@b.co")).toBe("a@b.co");
  });

  it.each([
    null,
    "",
    "no-at-sign",
    "@example.ca",
    "sam@",
    "sam@localhost",
    "sam@example",
    "sam@-example.ca",
    "sam@example.123",
    "sam lee@example.ca",
    '"sam"@example.ca',
    "sam..lee@example.ca",
    ".sam@example.ca",
    "sam@example.ca\r\nBcc: x@example.ca",
    "sam@exam\nple.ca",
    "sam,other@example.ca",
    "sam<x>@example.ca",
    "sàm@example.ca",
    `${"a".repeat(65)}@example.ca`,
    `sam@${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(60)}.ca`,
  ])("refuses %j", (raw) => {
    expect(parseRequesterEmail(raw)).toBeNull();
  });
});

/** Ports over a set, recording each mail; `mail` is what notify answers. */
function ports(mail: "sent" | "failed" = "sent") {
  const asked = new Set<string>();
  const mailed: string[] = [];
  const wired: InviteRequestPorts = {
    firstAsk: (email) => {
      if (asked.has(email)) return false;
      asked.add(email);
      return true;
    },
    forget: (email) => {
      asked.delete(email);
    },
    notify: async (email) => {
      mailed.push(email);
      return mail;
    },
  };
  return { wired, asked, mailed };
}

const SAM = parseRequesterEmail("sam@example.ca") as RequesterEmail;

describe("requestInvite", () => {
  it("mails the owner once for a first ask", async () => {
    const p = ports();
    expect(await requestInvite(p.wired, SAM)).toBe("received");
    expect(p.mailed).toEqual(["sam@example.ca"]);
  });

  it("answers a repeat exactly like a first ask, and mails nothing more", async () => {
    const p = ports();
    await requestInvite(p.wired, SAM);
    expect(await requestInvite(p.wired, SAM)).toBe("received");
    expect(p.mailed).toHaveLength(1);
  });

  it("forgets the address when the mail fails, so the visitor can ask again", async () => {
    const p = ports("failed");
    expect(await requestInvite(p.wired, SAM)).toBe("failed");
    expect(p.asked.has(SAM)).toBe(false);
    expect(await requestInvite(p.wired, SAM)).toBe("failed");
    expect(p.mailed).toHaveLength(2);
  });
});
