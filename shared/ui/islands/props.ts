// The one island props serialiser (P1.10; plan §5.1). Server data goes into HTML as JSON inside
// `<script type="application/json">`; the escapes below mean no string in it can end that element or read as markup.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export class SerializeError extends Error {
  readonly code: "islands.props_invalid" | "islands.props_too_large";
  constructor(code: SerializeError["code"]) {
    super(code);
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

/** Throws `props_invalid` unless `value` is plain JSON data: finite numbers, plain arrays and objects, no cycles. */
function validate(value: unknown, depth: number, ancestors: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (typeof value !== "object" || depth >= MAX_DEPTH || ancestors.has(value)) invalid();
  else validateContainer(value, depth, ancestors);
}

/** A plain array (no holes) or plain object, each child validated one level deeper. */
function validateContainer(value: object, depth: number, ancestors: WeakSet<object>): void {
  const isArray = Array.isArray(value);
  if (isArray ? Object.getPrototypeOf(value) !== Array.prototype : !isPlainObject(value)) invalid();
  ancestors.add(value);
  // Index loop for arrays, not for-of: a hole reads as `undefined`, which JSON would quietly turn into `null`.
  const children = isArray ? Array.from({ length: value.length }, (_, i) => i) : Object.keys(value);
  for (const key of children) {
    if (!Object.hasOwn(value, key)) invalid();
    validate((value as Record<string | number, unknown>)[key], depth + 1, ancestors);
  }
  ancestors.delete(value); // ancestors only: the same object twice in sibling branches is not a cycle
}

/** JSON for an inline script element. Throws `SerializeError` for non-JSON data or output over `maxBytes`. */
export function serializeProps(value: JsonValue, opts: { maxBytes?: number } = {}): string {
  validate(value, 0, new WeakSet());
  const json = JSON.stringify(value).replace(HTML_BREAKERS, (ch) => ESCAPES[ch] ?? ch);
  if (Buffer.byteLength(json, "utf8") > (opts.maxBytes ?? DEFAULT_MAX_BYTES)) {
    throw new SerializeError("islands.props_too_large");
  }
  return json;
}

/** The id and JSON for `<script type="application/json" id="{id}">{json}</script>`. */
export function renderPropsTag(id: string, value: JsonValue): { id: string; json: string } {
  if (!ID_PATTERN.test(id)) throw new Error(`island props id is not valid: ${JSON.stringify(id)}`);
  return { id, json: serializeProps(value) };
}
