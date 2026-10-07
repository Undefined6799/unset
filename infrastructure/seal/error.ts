// The one seal failure type (P1.14), on its own so context.ts and seal.ts can both throw it without importing each
// other.

export type SealCode = "seal.format" | "seal.unknown_kid" | "seal.auth_failed" | "seal.too_large";

/** A refused seal or unseal. Carries the code only: never the value, its parts or the context. */
export class SealError extends Error {
  readonly code: SealCode;

  constructor(code: SealCode) {
    super(code);
    this.name = "SealError";
    this.code = code;
  }
}
