// The one escape helper for what the preflight and its wrapper print (P1.35p S1; architecture 2026-10-15 02:08Z, N2;
// SE-7): reasons and errors carry names from the filesystem and values from the environment, and a person reads the
// lines.

/**
 * `text` as printable ASCII. A backslash is doubled; C0 and C1 controls, DEL and the rest of Latin-1 become `\xNN`;
 * every other code point outside ASCII, a lone surrogate too, becomes `\u{...}`. So no name can end a line, forge one or
 * move the cursor over it.
 */
export function printable(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (char === "\\") out += "\\\\";
    else if (code >= 0x20 && code < 0x7f) out += char;
    else if (code <= 0xff) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += `\\u{${code.toString(16)}}`;
  }
  return out;
}
