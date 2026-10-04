// Value scrubbing for log fields (P1.03; rule SE-7). The field allowlist is the main control; this catches an
// address, credential or key that slipped into an allowed string field anyway.

const MAX_LENGTH = 200;
const REDACTED = "[redacted]";

/** Shapes that never belong in a log, most specific first. Each match becomes `[redacted]`. */
const SENSITIVE: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g, // JWT
  /\bBearer\s+\S+/gi, // bearer token
  /[^\s@]+@[^\s@]+\.[^\s@]+/g, // email address
  /(?:did:key:)?z[1-9A-HJ-NP-Za-km-z]{40,}/g, // did:key or multibase key
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, // IPv4
  /(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?:%[\w.-]+)?/g, // IPv6, zone included
  /[A-Za-z0-9+/=_-]{32,}/g, // long hex, base64 or base64url run
];

/** C0 and C1 control characters and DEL. */
const isControl = (code: number): boolean => code <= 0x1f || (code >= 0x7f && code <= 0x9f);
const replaceControls = (text: string): string =>
  Array.from(text, (ch) => (isControl(ch.charCodeAt(0)) ? "?" : ch)).join("");

/** Truncates to 200 characters, replaces control characters with `?`, then redacts every sensitive shape. */
export function scrub(value: string): string {
  const cleaned = replaceControls(value.slice(0, MAX_LENGTH));
  return SENSITIVE.reduce((text, pattern) => text.replace(pattern, REDACTED), cleaned);
}
