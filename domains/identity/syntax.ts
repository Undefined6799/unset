// DID and handle syntax (P2.01), as atproto defines them: https://atproto.com/specs/handle ("Handle Identifier
// Syntax", "Additional Non-Syntax Restrictions") and https://atproto.com/specs/did ("Blessed DID Methods",
// "did:web in AT Protocol"), read from github.com/bluesky-social/atproto-website at 7937e9c. Every identifier that
// reaches the network is parsed here first, so a local or internal name never leaves as a lookup.

declare const didBrand: unique symbol;
declare const handleBrand: unique symbol;
/** A `did:plc` or hostname-only `did:web` identifier, minted only by `parseDid`. */
export type Did = string & { readonly [didBrand]: true };
/** A lowercase handle that may be resolved, minted only by `parseHandle`. */
export type Handle = string & { readonly [handleBrand]: true };

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** Two or more labels; the last (the TLD) does not start with a digit. The spec's reference regex, lowercase only. */
const HOSTNAME = new RegExp(`^(?:${LABEL}\\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$`);
const MAX_HOSTNAME = 253;
/** Valid syntax, but resolution must fail. `.test` is refused too: this app never resolves a development name. */
const DISALLOWED_TLDS = new Set([
  "alt",
  "arpa",
  "example",
  "internal",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
]);
const PLC = /^did:plc:[a-z2-7]{24}$/;
const WEB_PREFIX = "did:web:";
/** Printable ASCII only: checked before lowercasing, because some non-ASCII letters lowercase to ASCII (U+212A → k). */
const PRINTABLE_ASCII = /^[\x21-\x7e]*$/;

function isResolvableHostname(name: string): boolean {
  if (name.length > MAX_HOSTNAME || !HOSTNAME.test(name)) return false;
  return !DISALLOWED_TLDS.has(name.slice(name.lastIndexOf(".") + 1));
}

/**
 * `did:plc:` and 24 base32 characters, or `did:web:` and a lowercase hostname a handle could use (no port, path or
 * percent sign). DIDs are case-sensitive, so nothing is normalised. Anything else: null.
 */
export function parseDid(raw: string): Did | null {
  if (PLC.test(raw)) return raw as Did;
  if (raw.startsWith(WEB_PREFIX) && isResolvableHostname(raw.slice(WEB_PREFIX.length))) return raw as Did;
  return null;
}

/** A handle typed by a person: trimmed, one leading `@` removed, lowercased. Null when it may not be resolved. */
export function parseHandle(raw: string): Handle | null {
  const trimmed = raw.trim();
  const bare = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!PRINTABLE_ASCII.test(bare)) return null;
  const handle = bare.toLowerCase();
  return isResolvableHostname(handle) ? (handle as Handle) : null;
}
