// security.txt (P2.15; RFC 9116, read 2026-10-17, https://www.rfc-editor.org/rfc/rfc9116.html).
// Contact, Expires, Preferred-Languages, Canonical and Policy are §§2.5.3, 2.5.5, 2.5.8, 2.5.2 and 2.5.7.
// Expires is an RFC 3339 instant. A web URI in Contact, Canonical or Policy must be https in production;
// dev may use http because PUBLIC_ORIGIN does (shared/http/config.ts secureOrDev).
import { SECURITY_CONTACT_PAGE } from "./legal-placeholders.ts";

const DAY_MS = 86_400_000;

export type SecurityTxtExpiry = "ok" | "soon" | "stale" | "too_far" | "invalid";

/**
 * How `expires` stands relative to `now`. Boot refuses `invalid`, `stale` and `too_far` (more than 365 days ahead).
 * `soon` (within 30 days, still in the future) stays up and fails the renewal test.
 */
export function securityTxtExpiry(expires: string, now: number): SecurityTxtExpiry {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expires)) return "invalid";
  const at = Date.parse(expires);
  // An overflowed calendar date still parses; it must round-trip to the same instant.
  if (Number.isNaN(at) || new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z") !== expires) return "invalid";
  if (at <= now) return "stale";
  if (at > now + 365 * DAY_MS) return "too_far";
  if (at <= now + 30 * DAY_MS) return "soon";
  return "ok";
}

/** True when an https contact is on `origin` and carries no userinfo. `privacy-page` and mailto skip the origin check. */
export function securityContactAllowed(contact: string, origin: string): boolean {
  if (contact === SECURITY_CONTACT_PAGE || contact.startsWith("mailto:")) return true;
  if (!contact.startsWith("https:")) return false;
  try {
    const url = new URL(contact);
    return url.username === "" && url.password === "" && url.origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** The Contact value a researcher can use. `privacy-page` becomes the privacy notice on this origin. */
function securityContactValue(origin: string, contact: string): string {
  return contact === SECURITY_CONTACT_PAGE ? `${origin}/legal/privacy` : contact;
}

/** The file body. LF line endings are allowed (RFC 9116 §2.2). Comments start with `#` (§2.1). */
export function securityTxtDocument(input: { origin: string; contact: string; expires: string }): string {
  const contact = securityContactValue(input.origin, input.contact);
  return [
    "# Placeholder: not reviewed by a lawyer. This file is not legal advice.",
    `Contact: ${contact}`,
    `Expires: ${input.expires}`,
    "Preferred-Languages: en, fr",
    `Canonical: ${input.origin}/.well-known/security.txt`,
    `Policy: ${input.origin}/legal/terms`,
    "",
  ].join("\n");
}
