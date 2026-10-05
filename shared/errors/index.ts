// Error codes for every failure (P1.03): one catalog, an error class whose message is its code, and the only way a
// code goes into or comes out of a URL.
export { AppError } from "./AppError.ts";
export { ERROR_CODES, type ErrorCode, isErrorCode } from "./catalog.ts";
export { ERROR_MESSAGES } from "./messages.ts";
export { readErrorParam, withErrorParam } from "./redirect.ts";
