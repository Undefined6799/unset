// The one island props serialiser (P1.10; plan §5.1). Server data goes into HTML as JSON inside
// `<script type="application/json">`; the escapes below mean no string in it can end that element or read as markup.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export class SerializeError extends Error {
  readonly code: "islands.props_invalid" | "islands.props_too_large";
  constructor(code: SerializeError["code"], options?: { cause?: unknown }) {
    super(code, options);
    this.name = "SerializeError";
    this.code = code;
  }
}

/** Props get the same 15 KB bound as an island's code (§6.1), so a page cannot bloat silently. */
const DEFAULT_MAX_BYTES = 15_360;
const MAX_DEPTH = 32;
const ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;

/**
 * Less-than, greater-than, ampersand, line separator, paragraph separator. Written as escapes only: a literal U+2028
 * or U+2029 in this file would be invisible to review (a test checks the file holds none).
 */
const HTML_BREAKERS = /[\u003c\u003e\u0026\u2028\u2029]/g;
const ESCAPES: Readonly<Record<string, string>> = {
  "\u003c": "\\u003c",
  "\u003e": "\\u003e",
  "\u0026": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const invalid = (): never => {
  throw new SerializeError("islands.props_invalid");
};

/**
 * A lower bound on the output bytes so far. Checked during the walk, so a value whose shared subtrees would expand
 * to gigabytes (`v = [v, v]` repeated) stops at the size limit instead of walking every path.
 */
type Budget = { bytes: number; readonly max: number };

const spend = (budget: Budget, bytes: number): void => {
  budget.bytes += bytes;
  if (budget.bytes > budget.max) throw new SerializeError("islands.props_too_large");
};

/** An own data property's value; an accessor, a hidden (non-enumerable) or missing property is not plain data. */
function dataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) invalid();
  return (descriptor as PropertyDescriptor).value;
}

/**
 * A fresh plain copy of `value`, or `props_invalid` unless it is plain JSON data: finite numbers, plain arrays without
 * holes or extra properties, plain or null-prototype objects with only enumerable string-keyed data properties,
 * depth 32, no cycles. Each property is read once, so a getter or Proxy cannot answer differently when stringified.
 */
function copyPlain(value: unknown, depth: number, ancestors: WeakSet<object>, budget: Budget): JsonValue {
  if (typeof value === "number" && !Number.isFinite(value)) return invalid();
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    spend(budget, typeof value === "string" ? value.length + 2 : 1);
    return value;
  }
  if (typeof value !== "object" || depth >= MAX_DEPTH || ancestors.has(value)) return invalid();
  spend(budget, 2);
  ancestors.add(value);
  const copy = Array.isArray(value)
    ? copyArray(value, depth, ancestors, budget)
    : copyObject(value, depth, ancestors, budget);
  ancestors.delete(value); // ancestors only: the same object twice in sibling branches is not a cycle
  return copy;
}

function copyArray(value: unknown[], depth: number, ancestors: WeakSet<object>, budget: Budget): JsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const length = value.length;
  if (Reflect.ownKeys(value).length !== length + 1) invalid(); // holes or extra properties besides `length`
  return Array.from({ length }, (_, i) => copyPlain(dataValue(value, String(i)), depth + 1, ancestors, budget));
}

/**
 * A key reaches the page only if it needs no escape: JSON.stringify writes it unchanged (no quote, backslash, control
 * character or lone surrogate) and it holds none of the five HTML breakers. An escaped key cannot be trusted to
 * round-trip: V8's JSON.parse (Node 26.10 / V8 14.6, Chrome 141) can return the previous object's key for an escaped
 * one-character key (test v8_escaped_key_mixup_is_real). Values are unaffected.
 */
const KEY_BREAKERS = new RegExp(HTML_BREAKERS.source);
const isPlainKey = (key: string): boolean => JSON.stringify(key) === `"${key}"` && !KEY_BREAKERS.test(key);

function copyObject(value: object, depth: number, ancestors: WeakSet<object>, budget: Budget): JsonValue {
  if (!isPlainObject(value)) invalid();
  // Null prototype, so a `__proto__` key stays an own property of the copy.
  const copy: Record<string, JsonValue> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !isPlainKey(key)) invalid();
    spend(budget, (key as string).length + 3);
    copy[key as string] = copyPlain(dataValue(value, key as string), depth + 1, ancestors, budget);
  }
  return copy;
}

/** JSON for an inline script element. Throws `SerializeError` for non-JSON data or output over `maxBytes`. */
export function serializeProps(value: JsonValue, opts: { maxBytes?: number } = {}): string {
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!(Number.isInteger(max) && max > 0)) throw new RangeError("maxBytes must be a positive integer");
  let copy: JsonValue;
  try {
    copy = copyPlain(value, 0, new WeakSet(), { bytes: 0, max });
  } catch (error) {
    if (error instanceof SerializeError) throw error;
    throw new SerializeError("islands.props_invalid", { cause: error }); // a throwing getter or Proxy trap
  }
  const json = JSON.stringify(copy).replace(HTML_BREAKERS, (ch) => ESCAPES[ch] ?? ch);
  if (new TextEncoder().encode(json).length > max) throw new SerializeError("islands.props_too_large");
  return json;
}

/** The id and JSON for `<script type="application/json" id="{id}">{json}</script>`. */
export function renderPropsTag(id: string, value: JsonValue): { id: string; json: string } {
  if (!ID_PATTERN.test(id)) throw new Error(`island props id is not valid: ${JSON.stringify(id)}`);
  return { id, json: serializeProps(value) };
}
