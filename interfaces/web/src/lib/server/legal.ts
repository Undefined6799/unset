// The legal pages' settings and security.txt (P2.15; P1.20d), as interfaces/http/config.ts, legal-placeholders.ts and
// security-txt.ts had them before P1.20k deleted that folder. RFC 9116, read 2026-10-17,
// https://www.rfc-editor.org/rfc/rfc9116.html: Contact, Expires, Preferred-Languages, Canonical and Policy are
// §§2.5.3, 2.5.5, 2.5.8, 2.5.2 and 2.5.7; Expires is an RFC 3339 instant; LF line endings are allowed (§2.2).
import { str, withRule } from "@unset/shared-config";

/** security.txt Contact until a real mailto or https URI is set: the privacy notice on PUBLIC_ORIGIN. */
export const SECURITY_CONTACT_PAGE = "privacy-page";

const DAY_MS = 86_400_000;

export type SecurityTxtExpiry = "ok" | "soon" | "stale" | "too_far" | "invalid";

/** How `expires` stands relative to `now`. Boot refuses `invalid`, `stale` and `too_far` (over 365 days ahead). */
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

/** The file body. Comments start with `#` (§2.1). */
export function securityTxtDocument(input: { origin: string; contact: string; expires: string }): string {
  const contact = input.contact === SECURITY_CONTACT_PAGE ? `${input.origin}/legal/privacy` : input.contact;
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

/** Text that can be shown on a page: no C0 controls, no DEL, at most 200 characters. Not an email or a name. */
const PUBLIC_TEXT = new RegExp(
  `[^${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]{1,200}`,
);

/**
 * The three text keys have no default: until Alex sets them they hold the placeholder tokens. The legal pages'
 * {{pdsHost}} is PDS_HOSTNAME (config.ts, P1.20e).
 */
export const legalConfig = {
  PRIVACY_OFFICER_TITLE: str({ pattern: PUBLIC_TEXT }),
  PRIVACY_OFFICER_CONTACT: str({ pattern: PUBLIC_TEXT }),
  SUPPORT_EMAIL: str({ pattern: PUBLIC_TEXT }),
  SECURITY_CONTACT: withRule(str({ pattern: /(?:privacy-page|mailto:\S+|https:\/\/\S+)/ }), (config) => {
    const contact = config.SECURITY_CONTACT;
    const origin = config.PUBLIC_ORIGIN;
    return typeof contact === "string" && typeof origin === "string" && securityContactAllowed(contact, origin);
  }),
  SECURITY_TXT_EXPIRES: withRule(str({ pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/ }), (config) => {
    const expires = config.SECURITY_TXT_EXPIRES;
    if (typeof expires !== "string") return false;
    const state = securityTxtExpiry(expires, Date.now());
    return state === "ok" || state === "soon";
  }),
};
