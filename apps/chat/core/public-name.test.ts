// A chat partner's public name (ADR 0096): the door is asked once per chat ID with the device this page holds, and
// what it answers is shown only after the same cleaning as the profile page's name: no bidi or control characters,
// at most the lexicon's 64 graphemes. Anything else shows the handle alone. The door is a stand-in fetch (unmanaged,
// TE-1); its own side is tests/integration/chat-auth/door.test.ts.
import { describe, expect, test } from "vitest";
import { publicNames, shownName } from "./public-name.ts";

const CHAT_ID = `@u${"b".repeat(20)}:unset.cc`;
const deadline = () => AbortSignal.timeout(1000);

function door(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchFn, calls };
}

describe("shownName", () => {
  test("chat.name_clean: bidi and control characters go, spaces fold, and the rest is kept", () => {
    expect(shownName("Bea Ramos")).toBe("Bea Ramos");
    expect(shownName("\u202Eevil\u202C name")).toBe("evil name");
    expect(shownName("a\u2066b\u2069\u200Fc\u061C\u200Ed")).toBe("abcd");
    expect(shownName("tab\there\nnew\u0000line\u007F")).toBe("tab here newline");
    expect(shownName("  spaced   out  ")).toBe("spaced out");
    expect(shownName("Zoë 👩‍💻")).toBe("Zoë 👩‍💻");
  });

  test("chat.name_clamp: at most 64 graphemes, cut whole, never through an emoji", () => {
    expect(shownName("x".repeat(64))).toBe("x".repeat(64));
    expect(shownName("x".repeat(65))).toBe(`${"x".repeat(63)}…`);
    expect(shownName("👩‍💻".repeat(70))).toBe(`${"👩‍💻".repeat(63)}…`);
  });

  test("chat.name_none: nothing left, or not a string, is no name", () => {
    for (const raw of ["", "   ", "\u202E\u202C", "\u0000", null, undefined, 7, {}]) expect(shownName(raw)).toBeNull();
  });
});

describe("publicNames", () => {
  test("chat.name_found: the door's name, cleaned, asked once per chat ID", async () => {
    const d = door(200, { name: "\u202EBea\u202C" });
    const names = publicNames(d.fetchFn, "DEVICEAAAA", deadline);
    expect(await names(CHAT_ID)).toBe("Bea");
    expect(await names(CHAT_ID)).toBe("Bea");
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.url).toBe("/chat-name");
    expect(d.calls[0]?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ deviceId: "DEVICEAAAA", chatId: CHAT_ID }),
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  test("chat.name_missing: a 404, a fault or an answer of the wrong shape is no name", async () => {
    for (const d of [door(404, { error: "chat.not_found" }), door(200, { name: 7 }), door(200, {}), door(500, {})]) {
      expect(await publicNames(d.fetchFn, "DEVICEAAAA", deadline)(CHAT_ID)).toBeNull();
    }
    const broken = async () => {
      throw new TypeError("network");
    };
    expect(await publicNames(broken, "DEVICEAAAA", deadline)(CHAT_ID)).toBeNull();
  });
});
