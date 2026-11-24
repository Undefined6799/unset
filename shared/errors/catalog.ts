// The one error-code catalog (P1.03; plan §2 rule 15). Only these codes ever reach a URL, a response or a log.

type Status = 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 421 | 429 | 500 | 503;

/**
 * Every error code, `area.reason` in lowercase ASCII, with its HTTP status and whether a page may show it. A
 * non-public code never appears in a URL or a response body. Later steps add their codes here.
 */
export const ERROR_CODES = {
  "http.bad_request": { status: 400, public: true },
  "http.not_found": { status: 404, public: true },
  "http.method_not_allowed": { status: 405, public: true },
  "http.unsupported_media_type": { status: 415, public: true },
  "http.payload_too_large": { status: 413, public: true },
  "http.misdirected": { status: 421, public: true },
  "http.rate_limited": { status: 429, public: true },
  "http.deadline": { status: 503, public: true },
  "csrf.denied": { status: 403, public: true },
  "internal.error": { status: 500, public: true },
  "service.unavailable": { status: 503, public: true },
  // P1.11: no Postgres client freed up within PG_CONNECT_TIMEOUT_MS, so the request fails fast instead of queueing.
  "db.busy": { status: 503, public: true },
  // P1.22: a preference form sent a value outside its allowlist; only the write path uses it, never a cookie read.
  "prefs.invalid": { status: 400, public: true },
  // P2.05, signing in: each is shown on the sign-in form (`/login?error=`), never with the handle that caused it.
  "login.handle_invalid": { status: 400, public: true },
  // P1.36v: only accounts on our own PDS sign in.
  "login.account_elsewhere": { status: 403, public: true },
  "login.handle_not_found": { status: 404, public: true },
  "login.handle_unverified": { status: 400, public: true },
  "login.identity_unavailable": { status: 503, public: true },
  "login.pds_unreachable": { status: 503, public: true },
  "login.failed": { status: 500, public: true },
  "login.expired": { status: 400, public: true },
  // P2.06, the callback.
  "login.state_mismatch": { status: 400, public: true },
  "login.consent_denied": { status: 403, public: true },
  "login.scope_insufficient": { status: 403, public: true },
  "login.account_mismatch": { status: 403, public: true },
  // P2.07: the PDS wrapper ended the session because the grant is dead.
  "login.session_ended": { status: 401, public: true },
  // P2.08b: the sign-out's own delete failed; the cookie stays, so trying again finds the session.
  "logout.failed": { status: 503, public: true },
  // P2.20p, the profile save. Shown from a redirect (`error=`).
  "profile.invalid": { status: 400, public: true },
  "profile.too_long": { status: 400, public: true },
  "profile.url_invalid": { status: 400, public: true },
  "profile.name_required": { status: 400, public: true },
  "profile.conflict": { status: 409, public: true },
  "profile.pds_unavailable": { status: 503, public: true },
  // ADR 0091: the main page's card list, written with the card it lists.
  "page.invalid": { status: 400, public: true },
  "page.too_long": { status: 400, public: true },
  // P2.20r, the card writes (ADR 0051). Shown to the editor, which posts in the background.
  "card.invalid": { status: 400, public: true },
  "card.kind_unknown": { status: 400, public: true },
  "card.required": { status: 400, public: true },
  "card.too_long": { status: 400, public: true },
  // A card form past interfaces/http's form cap: a card saved elsewhere with many long rows, which this page cannot send.
  "card.form_too_large": { status: 413, public: true },
  // A links, collection or buttons card with no rows: it would show as an empty card.
  "card.empty": { status: 400, public: true },
  "card.url_invalid": { status: 400, public: true },
  "card.email_invalid": { status: 400, public: true },
  "card.order_invalid": { status: 409, public: true },
  "card.missing": { status: 404, public: true },
  "card.too_many": { status: 409, public: true },
  // The member's cards together would pass what one page holds (domains/profile MAX_PAGE_BYTES): nothing was written.
  "card.page_full": { status: 409, public: true },
  // More cards stored than a page shows (written outside this app): moving waits until the member deletes one.
  "card.overflow": { status: 409, public: true },
  // A new card's repo changed twice while it was being added (createRecord swapCommit refused); nothing was written.
  "card.cards_changed": { status: 409, public: true },
  // One record in a Save past one applyWrites body (1,000,000 bytes) by itself (ADR 0074); nothing was written.
  "card.save_too_large": { status: 413, public: true },
  // A Save too large for one PDS call, written in several, of which a later one failed; the page names what was saved.
  "card.save_partial": { status: 409, public: true },
  "card.list_incomplete": { status: 503, public: true },
  "card.conflict": { status: 409, public: true },
  "card.pds_unavailable": { status: 503, public: true },
  "card.scope_missing": { status: 403, public: true },
  // P2.19b: a picture card's new picture is not the member's upload, or is gone (a day unused) or held.
  "card.image_missing": { status: 409, public: true },
  // P2.19b: the picture could not be read from our store or sent to the member's PDS; nothing was written.
  "card.image_unavailable": { status: 503, public: true },
  // P2.19f (ADR 0088): the member's PDS refused the picture as too large (HTTP 413); no smaller copy is sent.
  "card.image_too_large": { status: 413, public: true },
  // P2.12, onboarding. Shown from a redirect (`error=`). None of them names the age threshold.
  "welcome.date_invalid": { status: 400, public: true },
  "welcome.terms_required": { status: 400, public: true },
  "welcome.country_required": { status: 400, public: true },
  // P2.10, invites. Shown on /invite from a redirect (`error=`).
  "invite.country_ack_required": { status: 400, public: true },
  "invite.bad_submission": { status: 400, public: true },
  "invite.in_progress": { status: 409, public: true },
  "invite.quota": { status: 429, public: true },
  "invite.closed": { status: 409, public: true },
  "invite.denied": { status: 403, public: true },
  "invite.unavailable": { status: 503, public: true },
  // P2.10r, invite requests (ADR 0080). Shown on /request-invite from a redirect (`error=`).
  "invite.request_bad_email": { status: 400, public: true },
  "invite.request_age_required": { status: 400, public: true },
  "invite.request_country_required": { status: 400, public: true },
  "config.invalid": { status: 500, public: false },
} as const satisfies Record<string, { status: Status; public: boolean }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** True when `value` is a catalog code (own key only, so `__proto__` and friends are not codes). */
export const isErrorCode = (value: string): value is ErrorCode => Object.hasOwn(ERROR_CODES, value);
