// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { PropsMissing, readProps } from "./readProps.ts";

afterEach(() => {
  document.body.replaceChildren();
});

function addScript(id: string, text: string): void {
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = id;
  script.textContent = text;
  document.body.append(script);
}

test("read_props_missing", () => {
  expect(() => readProps("nope")).toThrow(PropsMissing);
});

test("read_props_unparseable", () => {
  addScript("bad", "{not json");
  expect(() => readProps("bad")).toThrow(PropsMissing);
});

test("read_props_wrong_element", () => {
  const div = document.createElement("div");
  div.id = "div";
  div.textContent = "{}";
  document.body.append(div);
  expect(() => readProps("div")).toThrow(PropsMissing);
});

test("read_props_roundtrip", () => {
  addScript("p", '{"a":"\\u003c/script\\u003e","b":[1,null,true]}');
  expect(readProps("p")).toEqual({ a: "</script>", b: [1, null, true] });
});
