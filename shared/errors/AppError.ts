import { ERROR_CODES, type ErrorCode } from "./catalog.ts";

/** A failure with a catalog code. `message` is always the code: free text never travels in an error. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: (typeof ERROR_CODES)[ErrorCode]["status"];

  constructor(code: ErrorCode, options: { cause?: unknown } = {}) {
    super(code, options);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CODES[code].status;
  }
}
