// Error codes in URLs (plan §2 rule 15): only a public catalog code is ever written or read back.
import { ERROR_CODES, type ErrorCode, isErrorCode } from "./catalog.ts";

/**
 * `path` with `error=<code>` appended. `path` must already be a validated same-site path; P1.09's return-path
 * validator produces those, and this function does not check it again.
 */
export function withErrorParam(path: string, code: ErrorCode): string {
  return `${path}${path.includes("?") ? "&" : "?"}error=${code}`;
}

/** The `error` query value when it is a public catalog code, else `null`: a page never shows the raw value. */
export function readErrorParam(query: string | URLSearchParams): ErrorCode | null {
  const value = (typeof query === "string" ? new URLSearchParams(query) : query).get("error");
  if (value === null || !isErrorCode(value)) return null;
  return ERROR_CODES[value].public ? value : null;
}
