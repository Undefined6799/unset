// The page's own handling of the recovery key's printed form (ADR 0095 decision 2, ADR 0100): the check of its last
// characters before the page goes on, and the text file the Download button builds in the browser.
import { describe, expect, test } from "vitest";
import { CHECK_LENGTH, KEY_FILE_NAME, keyFileText, matchesEnd } from "./recovery-key.ts";

// The shape matrix-js-sdk 43.0.0 encodeRecoveryKey prints (src/crypto-api/recovery-key.ts:28-41): base58 in groups of 4.
const KEY = "EsTc 8b1q W9hX bKpz hN3d 6Qmk Yt2a Rf7L cVx4 Jn5u Gs9e Pw3Z";

describe("matchesEnd", () => {
  test("chat.key_check_end: exactly the last four characters match, spaces ignored", () => {
    expect(CHECK_LENGTH).toBe(4);
    expect(matchesEnd("Pw3Z", KEY)).toBe(true);
    expect(matchesEnd("  Pw 3Z ", KEY)).toBe(true);
  });

  test("chat.key_check_refuses: wrong case, too few, other characters or an empty answer are refused", () => {
    expect(matchesEnd("pw3z", KEY)).toBe(false);
    expect(matchesEnd("w3Z", KEY)).toBe(false);
    expect(matchesEnd("ePw3Z", KEY)).toBe(false);
    expect(matchesEnd("Pw3Y", KEY)).toBe(false);
    expect(matchesEnd("", KEY)).toBe(false);
    expect(matchesEnd(KEY.slice(0, 9), KEY)).toBe(false);
  });
});

describe("keyFileText", () => {
  test("chat.key_file: the file holds the key on its own line, plain words around it, and a fixed name", () => {
    const text = keyFileText(KEY);
    expect(text.split("\n")).toContain(KEY);
    expect(text).not.toMatch(/matrix|secret storage|cross-signing/i);
    expect(KEY_FILE_NAME).toBe("unset-chat-recovery-key.txt");
  });
});
