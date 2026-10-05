// Value scrubbing for log fields (P1.03; rule SE-7). The field allowlist is the main control; this catches an
// address, credential, DID or key that slipped into an allowed string field anyway.

const MAX_LENGTH = 200;
/** Raw input is capped before scrubbing so the patterns run on bounded text. */
const SCAN_LENGTH = 1000;
const REDACTED = "[redacted]";

/** Shapes that never belong in a log, most specific first. Each match becomes `[redacted]`. */
const SENSITIVE: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g, // JWT
  /\b(?:Bearer|Basic)\s+\S+/gi, // HTTP credentials
  /[^\s@]+@[^\s@]+\.[^\s@]+/g, // email address
  /\bdid:[a-z]+:[A-Za-z0-9._:%-]+/g, // any DID (before IPv6, whose pattern would eat its colons)
  /z[1-9A-HJ-NP-Za-km-z]{40,}/g, // multibase key
  /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g, // IPv4, also next to letters (`client_10.0.0.1`)
  // IPv6: eight full groups, or a `::` compression; a zone may follow. Times (`12:30:45`) are neither.
  /(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}(?:%[\w.-]+)?|(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4})*)?::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4})*)?(?:%[\w.-]+)?/g,
  /[A-Za-z0-9+/=_-]{32,}/g, // long hex, base64 or base64url run
];

/** C0 and C1 controls, DEL, line separators and bidi overrides: none may reshape a log line. */
const isControl = (code: number): boolean =>
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0x2028 ||
  code === 0x2029 ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);
const replaceControls = (text: string): string =>
  Array.from(text, (ch) => (isControl(ch.codePointAt(0) ?? 0) ? "?" : ch)).join("");

/**
 * Replaces control characters with `?`, redacts every sensitive shape, then truncates to `max` code points.
 * Deviation from the step book's order (truncate first): truncating first left partial addresses (`192.16`) behind.
 */
export function scrub(value: string, max = MAX_LENGTH): string {
  const redacted = SENSITIVE.reduce(
    (text, pattern) => text.replace(pattern, REDACTED),
    replaceControls(value.slice(0, SCAN_LENGTH)),
  );
  return Array.from(redacted).slice(0, max).join("");
}
