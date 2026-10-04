// The one return-path validator (P1.09; plan §2 rule 5). It turns an untrusted "where to go next" value into a
// same-origin relative path or nothing, so no redirect in the product can be pointed off-site.

declare const safePathBrand: unique symbol;
/** A path on our own origin, minted only by `safeReturnPath`. */
export type SafePath = string & { readonly [safePathBrand]: true };

/** Returning to these would loop through sign-in; matched on a path-segment boundary. */
export const DENIED_TARGETS = ["/login", "/logout", "/oauth"] as const;

const MAX_LENGTH = 512;
const PROBE_ORIGIN = "https://return.invalid";

/** C0, DEL, C1, U+2028, U+2029 and U+FEFF. Browsers strip tab, CR and LF from URLs, turning `/\t/x` into `//x`. */
function hasForbiddenCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfeff) {
      return true;
    }
  }
  return false;
}

const isDenied = (path: string): boolean =>
  DENIED_TARGETS.some(
    (target) => path === target || ["/", "?", "#"].some((boundary) => path.startsWith(target + boundary)),
  );

/**
 * A same-origin relative path, or `null`. The checks run in order and the first failure refuses; `allowPrefixes`
 * narrows the result further (for example `["/settings"]`).
 */
export function safeReturnPath(input: unknown, opts: { allowPrefixes?: readonly string[] } = {}): SafePath | null {
  if (typeof input !== "string") return null;
  if (input.length < 1 || input.length > MAX_LENGTH) return null;
  if (hasForbiddenCharacter(input)) return null;
  if (input.includes("\\")) return null; // browsers read `\` as `/` in special URLs
  if (input[0] !== "/" || input[1] === "/") return null; // exactly one leading slash: a path, never a host
  if (input.includes("//")) return null; // no app path needs it, and it survives normalisation as `/.//x`

  let resolved: URL;
  try {
    resolved = new URL(input, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (resolved.origin !== PROBE_ORIGIN) return null;

  const out = resolved.pathname + resolved.search + resolved.hash;
  if (!out.startsWith("/") || out.startsWith("//")) return null; // defence in depth after normalisation
  if (isDenied(out)) return null;
  if (opts.allowPrefixes && !opts.allowPrefixes.some((prefix) => out.startsWith(prefix))) return null;
  return out as SafePath;
}
