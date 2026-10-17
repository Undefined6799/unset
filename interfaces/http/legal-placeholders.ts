// The words Alex has not set (P2.15). Each token is the value itself until he replaces it. None of them is a
// name, an email, a phone number or a postal address.

export const PRIVACY_OFFICER_TITLE_TOKEN = "[to fill: PRIVACY_OFFICER_TITLE]";
export const PRIVACY_OFFICER_CONTACT_TOKEN = "[to fill: PRIVACY_OFFICER_CONTACT]";
export const SUPPORT_EMAIL_TOKEN = "[to fill: SUPPORT_EMAIL]";

/**
 * security.txt Contact until a real mailto or https URI is configured. The route expands it to the privacy page
 * on PUBLIC_ORIGIN (RFC 9116 §2.5.3 requires a URI; read 2026-10-17, https://www.rfc-editor.org/rfc/rfc9116.html).
 */
export const SECURITY_CONTACT_PAGE = "privacy-page";

/** RFC 3339 instant, more than 30 days ahead and at most 365 (security-txt.ts). Renew before it is "soon". */
export const SECURITY_TXT_EXPIRES = "2027-10-01T00:00:00Z";
