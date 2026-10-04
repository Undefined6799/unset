// Error codes in URLs (plan §2 rule 15): only a public catalog code is ever written or read back.
import { ERROR_CODES, type ErrorCode, isErrorCode } from "./catalog.ts";

/**
 * `path` with `error=<code>` appended. `path` must already be a validated same-site path; P1.09's return-path
 * validator produces those, and this function does not check it again.
 */
export function withErrorParam(path: string, code: ErrorCode): string {
  const hashAt = path.indexOf("#");
  const beforeHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const pathname = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = new URLSearchParams(queryAt === -1 ? "" : beforeHash.slice(queryAt + 1));
  query.set("error", code); // replaces any earlier `error`, so the page reads this code and no carried-over one
  return `${pathname}?${query}${hash}`;
}

/** The `error` query value when it is a public catalog code, else `null`: a page never shows the raw value. */
export function readErrorParam(query: string | URLSearchParams): ErrorCode | null {
  const value = (typeof query === "string" ? new URLSearchParams(query) : query).get("error");
  if (value === null || !isErrorCode(value)) return null;
  return ERROR_CODES[value].public ? value : null;
}
