// Values that must never be printed (P1.30): env-file contents and secrets. Nothing reads a value except through
// `use`, and every way a map can be turned into text (String, JSON, util.inspect, console) prints `[redacted]`.
import { inspect } from "node:util";

const REDACTED = "[redacted]";

export class SecretMap {
  readonly #values: ReadonlyMap<string, string>;
  /** The names `use` has read since `forgetReads`, so the runner can scrub their values from a reason (P1.30w). */
  readonly #read = new Set<string>();

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
    this.#read.add(name);
    return fn(this.#values.get(name));
  }

  forgetReads(): void {
    this.#read.clear();
  }

  /** `text` with every non-empty value `use` has read replaced by its name, longest value first. */
  scrubReads(text: string): string {
    const read = this.#readValues().sort(([a], [b]) => b.length - a.length);
    return read.reduce((out, [value, name]) => out.replaceAll(value, name), text);
  }

  /** Whether `text` still holds a non-empty value `use` has read. */
  holdsRead(text: string): boolean {
    return this.#readValues().some(([value]) => text.includes(value));
  }

  #readValues(): [string, string][] {
    return [...this.#read].flatMap((name) => {
      const value = this.#values.get(name);
      return value === undefined || value === "" ? [] : [[value, name] as [string, string]];
    });
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
