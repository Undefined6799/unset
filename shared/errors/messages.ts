// English text for each public error code, until the i18n slice turns this into the EN/FR catalogs (P1.19).
import type { ERROR_CODES } from "./catalog.ts";

type PublicCode = {
  [C in keyof typeof ERROR_CODES]: (typeof ERROR_CODES)[C]["public"] extends true ? C : never;
}[keyof typeof ERROR_CODES];

/** What a page says for each public code. Plain text; the page escapes it like any other string. */
export const ERROR_MESSAGES: Record<PublicCode, string> = {
  "http.bad_request": "That request could not be understood.",
  "http.not_found": "That page does not exist.",
  "http.method_not_allowed": "That action is not allowed here.",
  "http.unsupported_media_type": "That kind of content is not accepted here.",
  "http.payload_too_large": "That is too large to send.",
  "http.misdirected": "That request reached the wrong address.",
  "http.rate_limited": "Too many tries. Wait a moment and try again.",
  "http.deadline": "That took too long. Try again.",
  "csrf.denied": "The form expired or came from another site. Reload the page and try again.",
  "internal.error": "Something went wrong on our side.",
  "service.unavailable": "This is unavailable right now. Try again soon.",
  "db.busy": "We're busy right now. Try again in a moment.",
  "prefs.invalid": "That choice is not one of the options.",
};
