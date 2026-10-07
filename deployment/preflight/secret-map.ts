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
