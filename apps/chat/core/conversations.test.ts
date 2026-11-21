// The page's own rules for conversations (build step 9), as values: which chat ID the start route takes, and when the
// composer is on. The composer stays off until the other person has joined and encryption is on in this browser's
// crypto (the spike of 2026-11-20 sent plaintext right after createRoom otherwise).
import { describe, expect, test } from "vitest";
import { availableOf, composerOf, nameOf, parseChatId, startTarget } from "./conversations.ts";

const ME = "@uaaaaaaaaaaaaaaaaaaaa:unset.cc";
const THEM = "@ubbbbbbbbbbbbbbbbbbbb:unset.cc";

describe("parseChatId", () => {
  test("chat.chat_id_valid: a chat ID on our own server is taken", () => {
    expect(parseChatId(THEM, ME)).toBe(THEM);
    expect(parseChatId("@u234567abcdefghijklmn:unset.cc", ME)).toBe("@u234567abcdefghijklmn:unset.cc");
  });

  test.each([
    ["@ubbbbbbbbbbbbbbbbbbbb:other.example", "another server"],
    ["@ubbbbbbbbbbbbbbbbbbbb:unset.cc:443", "a port"],
    ["@ubbbbbbbbbbbbbbbbbbb:unset.cc", "19 characters"],
    ["@ubbbbbbbbbbbbbbbbbbbbb:unset.cc", "21 characters"],
    ["@uBBBBBBBBBBBBBBBBBBBB:unset.cc", "upper case"],
    ["@ub1bbbbbbbbbbbbbbbbbb:unset.cc", "a digit outside base32"],
    ["@xbbbbbbbbbbbbbbbbbbbb:unset.cc", "no leading u"],
    ["ubbbbbbbbbbbbbbbbbbbb:unset.cc", "no @"],
    [` ${THEM}`, "a space"],
    [`${THEM}\n`, "a newline"],
    [ME, "your own chat ID"],
    ["", "nothing"],
  ])("chat.chat_id_refused: %s (%s)", (raw) => {
    expect(parseChatId(raw, ME)).toBeNull();
  });
});

describe("startTarget", () => {
  test("chat.start_route: /?with=<chat ID> names the person to start with", () => {
    expect(startTarget(`?with=${encodeURIComponent(THEM)}`, ME)).toBe(THEM);
    expect(startTarget(`?with=${THEM}`, ME)).toBe(THEM);
  });

  test.each([
    ["", "no query"],
    ["?other=1", "no with"],
    [`?with=${THEM}&with=${THEM}`, "two"],
    ["?with=%E0%A4%A", "a broken escape"],
    ["?with=@ubbbbbbbbbbbbbbbbbbbb:evil.example", "another server"],
  ])("chat.start_route_refused: %s (%s)", (search) => {
    expect(startTarget(search, ME)).toBeNull();
  });
});

describe("composerOf", () => {
  const on = { mine: "join", otherJoined: true, kind: "encrypted", encryptionOn: true } as const;

  test("chat.composer_on: joined, the other person joined, an encrypted room with encryption on here", () => {
    expect(composerOf(on)).toBe("on");
  });

  test.each([
    [{ ...on, mine: "invite" }, "request"],
    [{ ...on, mine: "leave" }, "gone"],
    [{ ...on, kind: "not_encrypted" }, "not_encrypted"],
    [{ ...on, kind: "not_encrypted", encryptionOn: false }, "not_encrypted"],
    [{ ...on, otherJoined: false }, "waiting_for_them"],
    [{ ...on, encryptionOn: false }, "waiting_for_encryption"],
    [{ ...on, otherJoined: false, encryptionOn: false }, "waiting_for_them"],
  ] as const)("chat.composer_off: %o is %s", (facts, composer) => {
    expect(composerOf(facts)).toBe(composer);
  });
});

describe("availableOf", () => {
  test("chat.available_one_to_one: two people at most, joined or invited, in a room only an invite lets in", () => {
    expect(availableOf({ joinRule: "invite", people: 2 })).toBe(true);
    expect(availableOf({ joinRule: "invite", people: 1 })).toBe(true);
  });

  test.each([
    [{ joinRule: "invite", people: 3 }, "a third person"],
    [{ joinRule: "public", people: 2 }, "a public room"],
    [{ joinRule: "knock", people: 2 }, "a room one may knock on"],
    [{ joinRule: "restricted", people: 2 }, "a room another room's members may join"],
    [{ joinRule: undefined, people: 2 }, "no join rule seen"],
  ] as const)("chat.available_refused: %o (%s) is unavailable", (facts, _reason) => {
    expect(availableOf(facts)).toBe(false);
  });
});

describe("nameOf", () => {
  test("chat.name_shown: a person is shown by the name they chose", () => {
    expect(nameOf("Bea", THEM)).toBe("Bea");
  });

  test.each<[string | undefined, string]>([
    [undefined, "no member event"],
    ["", "an empty name"],
    ["  ", "a blank name"],
    [THEM, "the SDK's fallback to the chat ID"],
    ["ubbbbbbbbbbbbbbbbbbbb", "the chat ID's local part, the homeserver's default"],
  ])("chat.name_former_member: %j (%s) is shown as Former member, never as the chat ID", (name) => {
    expect(nameOf(name, THEM)).toBe("Former member");
  });
});
