import { timingSafeEqual } from "node:crypto";
import { inspect } from "node:util";

const HIDDEN = "[secret]";

/**
 * A configuration secret. The value leaves only through `reveal()`; every way of printing it (`String`, template
 * literals, `JSON.stringify`, `util.inspect`, `console.log`) gives `[secret]`.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  /** The secret itself. Call it only where the value is used, never to log or return it. */
  reveal(): string {
    return this.#value;
  }

  /** Constant-time comparison: the time taken does not depend on where the values differ. */
  equals(other: Secret): boolean {
    const a = Buffer.from(this.#value, "utf8");
    const b = Buffer.from(other.reveal(), "utf8");
    // Compare equal-length buffers either way, so a length mismatch costs the same as a content mismatch.
    return timingSafeEqual(a, a.length === b.length ? b : a) && a.length === b.length;
  }

  toString(): string {
    return HIDDEN;
  }

  toJSON(): string {
    return HIDDEN;
  }

  [inspect.custom](): string {
    return HIDDEN;
  }
}
