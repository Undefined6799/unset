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
  // P2.12, onboarding. Shown from a redirect (`error=`). None of them names the age threshold.
  "welcome.date_invalid": { status: 400, public: true },
  "welcome.terms_required": { status: 400, public: true },
  "welcome.country_required": { status: 400, public: true },
  "config.invalid": { status: 500, public: false },
} as const satisfies Record<string, { status: Status; public: boolean }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** True when `value` is a catalog code (own key only, so `__proto__` and friends are not codes). */
export const isErrorCode = (value: string): value is ErrorCode => Object.hasOwn(ERROR_CODES, value);
