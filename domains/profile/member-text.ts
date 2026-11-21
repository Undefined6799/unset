// What text a member may write on their page: printable text only. A control character draws nothing, and the index's
// store (Postgres jsonb) refuses a NUL and a lone surrogate outright (postgresql.org/docs/current/datatype-json.html),
// so a record carrying one is left out of the index and the public page goes missing (index-plan.ts storable; staging
// break test 2026-11-21). Checked when the member saves, so the save is refused instead.

/** Every control character (Unicode general category Cc: C0, DEL and C1), NUL included. */
const CONTROL = /\p{Cc}/u;
/** Multi-line text keeps its line breaks (already "\n" only) and tabs; every other control is refused. */
const CONTROL_EXCEPT_LINES = /(?![\n\t])\p{Cc}/u;

/**
 * What a name may not hold, so it cannot be shown reversed or out of order, or look the same as another name
 * (unicode.org/reports/tr36, "Bidirectional Text Spoofing"; unicode.org/reports/tr9 for the controls):
 * - the bidirectional embeddings, overrides and isolates, U+202A..U+202E and U+2066..U+2069;
 * - characters that draw nothing: zero width space U+200B, word joiner U+2060, zero width no-break space U+FEFF,
 *   soft hyphen U+00AD, Mongolian vowel separator U+180E, and the Hangul fillers U+115F, U+1160, U+3164, U+FFA0.
 * The joiners U+200C and U+200D stay: Persian, the Indic scripts and emoji sequences need them.
 */
const NAME_SPOOF = /[‪-‮⁦-⁩​⁠﻿­᠎ᅟᅠㅤﾠ]/u;

/** Whether `text` holds only printable characters; `multiline` text may also hold line breaks and tabs. */
export function isPlainText(text: string, multiline: boolean): boolean {
  if (!text.isWellFormed()) return false;
  return !(multiline ? CONTROL_EXCEPT_LINES : CONTROL).test(text);
}

/** Whether `name` is plain one-line text with no bidirectional control and no invisible character. */
export function isPlainName(name: string): boolean {
  return isPlainText(name, false) && !NAME_SPOOF.test(name);
}
