// The one link validator (P1.24h; book P1.24 Outputs, plan §2 Output rule: `safeHref` for links). It turns an
// untrusted link into the parsed, normalised `href` of an allowed kind, or nothing. Every link a component renders
// takes a `SafeHref`, so `javascript:`, `data:`, `vbscript:` and protocol-relative links cannot reach the page.
//
// Parsing is the WHATWG URL Standard's (https://url.spec.whatwg.org/#concept-basic-url-parser), which Node 26's
// `URL` implements (https://nodejs.org/docs/latest-v26.x/api/url.html#the-whatwg-url-api). That parser strips tab,
// CR and LF anywhere and reads `\` as `/` in http and https URLs, so `/\t/x` and `/\x` would become `//x`; both are
// refused before parsing, and a path's origin is checked after it. safe-href.test.ts proves each case.

declare const safeHrefBrand: unique symbol;
/** A link of an allowed kind, minted only by `safeHref`. */
export type SafeHref = string & { readonly [safeHrefBrand]: true };

/** The kinds a caller may allow: an absolute URL with one of these schemes, or a same-origin path. */
export type HrefScheme = "http:" | "https:" | "mailto:" | "path";

const MAX_LENGTH = 2000;
const PROBE_ORIGIN = "https://href.invalid";

/** C0, DEL, C1, U+2028, U+2029 and U+FEFF, which browsers strip or treat specially inside URLs. */
function hasForbiddenCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfeff) {
      return true;
    }
  }
  return false;
}

/** A path on our origin: exactly one leading `/`, never `//` or `/\`; the result is its parsed path, query and hash. */
function safePath(text: string): SafeHref | null {
  if (text[0] !== "/" || text[1] === "/" || text[1] === "\\") return null;
  let resolved: URL;
  try {
    resolved = new URL(text, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (resolved.origin !== PROBE_ORIGIN) return null;
  return (resolved.pathname + resolved.search + resolved.hash) as SafeHref;
}

/** An absolute URL whose scheme is allowed; http and https carry no username or password. */
function safeAbsolute(text: string, allow: readonly HrefScheme[]): SafeHref | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null; // relative input, or not a URL
  }
  if (!(allow as readonly string[]).includes(url.protocol) || url.protocol === "path") return null;
  if ((url.protocol === "http:" || url.protocol === "https:") && (url.username !== "" || url.password !== "")) {
    return null;
  }
  return url.href as SafeHref;
}

/**
 * The parsed, normalised `href` of `raw` if it is a link of a kind in `allow`, else `null`. The checks run in order
 * and the first failure refuses. Schemes outside `allow` (always `javascript:`, `data:` and `vbscript:`, which no
 * caller can allow) are refused.
 */
export function safeHref(raw: string, allow: readonly HrefScheme[]): SafeHref | null {
  const text = raw.trim();
  if (text.length < 1 || text.length > MAX_LENGTH) return null;
  if (hasForbiddenCharacter(text)) return null;
  if (!text.isWellFormed()) return null; // a lone surrogate would be rewritten to U+FFFD, not kept
  if (text.startsWith("//") || text.startsWith("\\")) return null; // protocol-relative, never a path or a URL
  const href = text.startsWith("/") ? (allow.includes("path") ? safePath(text) : null) : safeAbsolute(text, allow);
  if (href === null || href.length > MAX_LENGTH) return null; // percent-encoding can grow it past the cap
  return href;
}
