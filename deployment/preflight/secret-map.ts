// Values that must never be printed (P1.30): env-file contents and secrets. Nothing reads a value except through
// `use`, and every way a map can be turned into text (String, JSON, util.inspect, console) prints `[redacted]`.
import { inspect } from "node:util";

const REDACTED = "[redacted]";

export class SecretMap {
  readonly #values: ReadonlyMap<string, string>;

  constructor(values: Iterable<readonly [string, string]>) {
    this.#values = new Map(values);
  }

  has(name: string): boolean {
    return this.#values.has(name);
  }

  names(): string[] {
    return [...this.#values.keys()];
  }

  /** Runs `fn` on the value, or on undefined when the name is absent; only `fn`'s answer leaves the map. */
  use<T>(name: string, fn: (value: string | undefined) => T): T {
    return fn(this.#values.get(name));
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

/**
 * Every non-empty value the readers handed out in one run: env files (the `.env` included) and compose `environment`
 * values (P1.30m; architecture, end of record 2026-10-12-c18-follow-ups). The runner asks only whether a reason holds
 * one; the values never leave, and the set prints as `[redacted]` like a SecretMap.
 */
export class ConfiguredValues {
  readonly #values: ReadonlySet<string>;

  constructor(values: Iterable<string>) {
    this.#values = new Set([...values].filter((value) => value !== ""));
  }

  occurIn(text: string): boolean {
    for (const value of this.#values) if (text.includes(value)) return true;
    return false;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
