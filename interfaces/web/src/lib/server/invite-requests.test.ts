import { parseRequesterEmail, type RequesterEmail } from "@unset/domains-identity";
import type { Mail } from "@unset/infrastructure-email";
import { describe, expect, it } from "vitest";
import { createAskWindow, notifyOwner } from "./invite-requests.ts";

const email = (raw: string): RequesterEmail => parseRequesterEmail(raw) as RequesterEmail;

describe("createAskWindow", () => {
  it("lets an address ask once per window, whatever its letter case", () => {
    let now = 0;
    const window = createAskWindow({ now: () => now, windowMs: 1000 });
    expect(window.firstAsk(email("sam@example.ca"))).toBe(true);
    expect(window.firstAsk(email("Sam@Example.ca"))).toBe(false);
    now = 999;
    expect(window.firstAsk(email("sam@example.ca"))).toBe(false);
    now = 1000;
    expect(window.firstAsk(email("sam@example.ca"))).toBe(true);
  });

  it("forgets an address on request", () => {
    const window = createAskWindow({ now: () => 0 });
    window.firstAsk(email("sam@example.ca"));
    window.forget(email("sam@example.ca"));
    expect(window.firstAsk(email("sam@example.ca"))).toBe(true);
  });

  it("drops the oldest address when full", () => {
    const window = createAskWindow({ now: () => 0, max: 2 });
    window.firstAsk(email("a@example.ca"));
    window.firstAsk(email("b@example.ca"));
    window.firstAsk(email("c@example.ca"));
    expect(window.firstAsk(email("c@example.ca"))).toBe(false);
    expect(window.firstAsk(email("a@example.ca"))).toBe(true);
  });
});

describe("notifyOwner", () => {
  it("mails only the owner, with the visitor as Reply-To and the invite page named", async () => {
    const sent: Mail[] = [];
    const notify = notifyOwner(
      { send: async (mail) => (sent.push(mail), "sent") },
      "owner@example.ca",
      "https://unset.example",
      AbortSignal.timeout(1000),
    );
    expect(await notify(email("sam@example.ca"))).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("owner@example.ca");
    expect(sent[0]?.replyTo).toBe("sam@example.ca");
    expect(sent[0]?.text).toContain("Their email address: sam@example.ca");
    expect(sent[0]?.text).toContain("https://unset.example/invite");
  });
});
