// The recovery key's printed form on the page (ADR 0083 decision 2, ADR 0089). The page never makes or reads the key
// itself: matrix-js-sdk 43.0.0 prints it as base58 in groups of four (src/crypto-api/recovery-key.ts:28-41). Here are
// only the check of its last characters before the page goes on, and the text the Download button saves, which is
// built in the browser and never sent anywhere.

/** How many of the key's last characters the person types back. */
export const CHECK_LENGTH = 4;
export const KEY_FILE_NAME = "unset-chat-recovery-key.txt";

const compact = (text: string) => text.replace(/\s+/g, "");

/** Whether `typed` is exactly the key's last CHECK_LENGTH characters, with any spaces left out. */
export function matchesEnd(typed: string, key: string): boolean {
  const answer = compact(typed);
  return answer.length === CHECK_LENGTH && compact(key).endsWith(answer);
}

/** The Download file: the key on its own line, and what it is for. */
export const keyFileText = (key: string): string =>
  [
    "Your recovery key for messages on unset.cc",
    "",
    key,
    "",
    "Keep it somewhere safe. You need it to read your messages in a new browser.",
    "",
  ].join("\n");
