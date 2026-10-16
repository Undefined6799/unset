// Object keys that JSON would escape are refused (P1.10). V8's JSON.parse (Node 26.10 / V8 14.6, and Chrome 141)
// can return the previous object's key for an escaped one-character key, so an escaped key cannot round-trip.
import { expect, test } from "vitest";
import { SerializeError, serializeProps } from "./props.ts";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof SerializeError) return error.code;
    throw error;
  }
  return "serialised";
}

const ch = (code: number): string => String.fromCharCode(code);

test("v8_escaped_key_mixup_is_real", () => {
  // The engine bug this guard exists for; if V8 fixes it, this test fails and the guard can be reconsidered.
  JSON.parse('{"x":1,"\\\\":1}');
  expect(Object.keys(JSON.parse('{"x":1,"\\n":1}'))).toEqual(["x", "\\"]);
});

test("escaped_keys_are_refused", () => {
  const keys = ["<", ">", "&", '"', "\\", "\n", ch(0), ch(0x1f), ch(0x2028), ch(0x2029), ch(0xd800), `a${ch(0xdc00)}`];
  for (const key of keys) expect(codeOf(() => serializeProps({ [key]: 1 }))).toBe("islands.props_invalid");
  expect(codeOf(() => serializeProps({ ok: { "</script": 1 } }))).toBe("islands.props_invalid");
});

test("plain_keys_still_round_trip", () => {
  const value = { "": 1, "data-id": 2, été: 3, "\u{1f600}": 4, __proto__x: 5 };
  expect(JSON.parse(serializeProps(value))).toEqual(value);
});

test("breaker_values_still_allowed", () => {
  const value = { text: `</script><!--&${ch(0x2028)}"\\` };
  expect(JSON.parse(serializeProps(value))).toEqual(value);
});
