// A page's data address (book P1.22h): SvelteKit answers `<page>/__data.json` for every page route with the result of
// its server loads, whatever `csr` says, so the address is served for pages that run no script too (kit 3.2.0
// src/runtime/server/respond.js `is_data_request`, data/index.js `render_data`). The answer is JSON: one node per
// layout and page, each `data` (devalue's flat form), `skip` (the client asked to leave it out with
// `?x-sveltekit-invalidated=`), an error with a code, or null for a page with no server load; a redirect is its own
// answer. A missing page is an error node under status 200, so the tests read the node, never the status alone.
// These helpers read an answer back and hold it against the page the same viewer gets (rule SE-3).
// A page that runs the client also carries the same loads' results in its start-up script (book P1.22e; kit 3.2.0
// src/runtime/server/page/render.js, the `data:` line of `kit.start`), written by devalue's `uneval` as a JavaScript
// literal; `startupData` reads it back without running it.
import { parse } from "parse5";

/** Appended to a page's path. */
export const DATA = "/__data.json";
/** Asks for the root layout's node alone, as the client does when only it is stale (kit respond.js INVALIDATED_PARAM). */
export const LAYOUT_ONLY = `${DATA}?x-sveltekit-invalidated=10`;

export type DataNode =
  | { readonly type: "data"; readonly data: unknown }
  | { readonly type: "skip" }
  | { readonly type: "error"; readonly error: unknown }
  | null;
export type DataAnswer =
  | { readonly type: "data"; readonly nodes: readonly DataNode[] }
  | { readonly type: "redirect"; readonly status: number; readonly location: string };

/** devalue's index for `undefined` (devalue 5.9.4 src/constants.js UNDEFINED). */
const UNDEFINED = -1;

/**
 * Reads devalue's flat form back (devalue 5.9.4 src/parse.js `unflatten`): a list whose first entry is the root, where
 * an object's fields and a list's entries are indexes into the same list. Only what our loads return is read: plain
 * objects, lists, strings, numbers, booleans, null and undefined. Anything else (a Date, a Map, a promise) is an
 * error here, so a load that starts sending one is looked at, never skipped.
 */
function unflatten(flat: unknown): unknown {
  if (!Array.isArray(flat) || flat.length === 0) throw new Error("data address: not devalue's flat form");
  const read = (index: unknown): unknown => {
    if (index === UNDEFINED) return undefined;
    if (typeof index !== "number" || index < 0 || index >= flat.length) {
      throw new Error("data address: an index outside the list, or a devalue value these tests do not read");
    }
    const value: unknown = flat[index];
    if (value === null || typeof value !== "object") return value;
    if (!Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).map(([name, at]) => [name, read(at)]));
    }
    // A list that starts with a string is one of devalue's own types (["Date", ...], ["Map", ...]).
    if (typeof value[0] === "string") throw new Error(`data address: a devalue ${value[0]} these tests do not read`);
    return value.map(read);
  };
  return read(0);
}

/** The answer at a data address, each node's data read back. */
export async function dataAnswer(response: Response): Promise<DataAnswer> {
  const answer = (await response.json()) as
    | { type: "redirect"; status: number; location: string }
    | { type: "data"; nodes: ({ type: string; data?: unknown; error?: unknown } | null)[] };
  if (answer.type === "redirect") return answer;
  if (answer.type !== "data") throw new Error("data address: neither data nor a redirect");
  const nodes = answer.nodes.map((node): DataNode => {
    if (node === null) return null;
    if (node.type === "skip") return { type: "skip" };
    if (node.type === "error") return { type: "error", error: node.error };
    if (node.type !== "data") throw new Error(`data address: a ${node.type} node these tests do not read`);
    return { type: "data", data: unflatten(node.data) };
  });
  return { type: "data", nodes };
}

/** The data of node `at` (0 the root layout, 1 the page), or an error when that node is not data. */
export function nodeData(answer: DataAnswer, at: number): unknown {
  const node = answer.type === "data" ? answer.nodes[at] : undefined;
  if (node === undefined || node === null || node.type !== "data")
    throw new Error(`data address: node ${at} is no data`);
  return node.data;
}

/** Every leaf of `value` with its path, a list's entries under `[]`: `cards[].shown.kind`. An empty list is a leaf. */
export function leaves(value: unknown, path = ""): [path: string, leaf: unknown][] {
  if (Array.isArray(value)) {
    return value.length === 0 ? [[path, value]] : value.flatMap((entry) => leaves(entry, `${path}[]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([name, field]) => leaves(field, path === "" ? name : `${path}.${name}`));
  }
  return [[path, value]];
}

/** The fields `value` has, sorted, each once: the shape a test pins, so a new field is seen. */
export const fieldsOf = (value: unknown): string[] => [...new Set(leaves(value).map(([path]) => path))].sort();

type HtmlNode = Readonly<{
  nodeName?: string;
  attrs?: readonly Readonly<{ name?: string; value: string }>[];
  childNodes?: readonly HtmlNode[];
  content?: HtmlNode;
  value?: string;
}>;

/** Every element of a page, in document order, as the HTML parsing algorithm reads the bytes (parse5 8.0.1). */
function elementsIn(html: string): HtmlNode[] {
  const found: HtmlNode[] = [];
  const walk = (node: HtmlNode): void => {
    if (node.attrs !== undefined) found.push(node);
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content !== undefined) walk(node.content);
  };
  walk(parse(html) as HtmlNode);
  return found;
}

const scriptsOf = (html: string): HtmlNode[] => elementsIn(html).filter((node) => node.nodeName === "script");

/** Every element of a page as its tag name and its attributes, so a test can hold what the markup is, not its bytes. */
export function elementsOf(html: string): { name: string; attributes: Readonly<Record<string, string>> }[] {
  return elementsIn(html).map((node) => ({
    name: node.nodeName ?? "",
    attributes: Object.fromEntries((node.attrs ?? []).map((attribute) => [attribute.name ?? "", attribute.value])),
  }));
}

/** The words a page shows: its text run together, a script's left out (shownBy). */
export const pageText = (html: string): string => shownBy(html).text;

/**
 * What a page shows: all of its text run together, and every attribute's value. A script's text is not shown: it
 * holds the page's data whether a component draws it or not, so counting it would call every field drawn.
 */
function shownBy(html: string): { text: string; attributes: Set<string> } {
  const attributes = new Set<string>();
  let text = "";
  const walk = (node: HtmlNode): void => {
    if (node.nodeName === "script") return;
    for (const attribute of node.attrs ?? []) attributes.add(attribute.value);
    if (node.value !== undefined) text += node.value;
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content !== undefined) walk(node.content);
  };
  walk(parse(html) as HtmlNode);
  return { text, attributes };
}

/** The text of each inline script of a page (one without `src`), as a browser would run it. */
export function inlineScripts(html: string): string[] {
  return scriptsOf(html)
    .filter((script) => !(script.attrs ?? []).some((attribute) => attribute.name === "src"))
    .map((script) => (script.childNodes ?? []).map((child) => child.value ?? "").join(""));
}

/** How many script elements a page has, of any kind. */
export const scriptCount = (html: string): number => scriptsOf(html).length;

/**
 * Reads one value of devalue's `uneval` form at `at` (devalue 5.9.4 src/uneval.js): an object with bare or quoted
 * keys, a list, a double-quoted string (its escapes are JSON's, src/utils.js `stringify_string`), a number, true,
 * false, null and `void 0`. It reads the text and never runs it. Anything else (a shared reference, which uneval
 * writes as a function call, a Date, a Map) is an error here, so a load that starts sending one is looked at.
 */
function readLiteral(text: string, at: number): Read {
  const start = skipSpace(text, at);
  const char = text[start];
  if (char === '"') return readString(text, start);
  if (char === "[") return readSeries(text, start, "]", (from) => readLiteral(text, from));
  if (char !== "{") return readWord(text, start);
  const fields = readSeries(text, start, "}", (from) => readField(text, from));
  return { value: Object.fromEntries(fields.value), end: fields.end };
}

/** A value read from the start-up script's text, and where the text after it begins. */
type Read<T = unknown> = { value: T; end: number };

function failAt(text: string, what: string, where: number): never {
  throw new Error(`start-up data: ${what} at ${where}: ${text.slice(where, where + 40)}`);
}

function skipSpace(text: string, from: number): number {
  let to = from;
  while (/\s/.test(text[to] ?? "")) to += 1;
  return to;
}

function readString(text: string, from: number): Read<string> {
  let to = from + 1;
  while (to < text.length && text[to] !== '"') to += text[to] === "\\" ? 2 : 1;
  if (text[to] !== '"') return failAt(text, "an open string", from);
  return { value: JSON.parse(text.slice(from, to + 1)) as string, end: to + 1 };
}

/** What stands between the bracket at `open` and its `close`, each entry read by `entry` and parted by commas. */
function readSeries<T>(text: string, open: number, close: string, entry: (from: number) => Read<T>): Read<T[]> {
  const entries: T[] = [];
  let next = skipSpace(text, open + 1);
  while (text[next] !== close) {
    const one = entry(next);
    entries.push(one.value);
    next = skipSpace(text, one.end);
    if (text[next] === ",") next = skipSpace(text, next + 1);
    else if (text[next] !== close) failAt(text, `no ${close}`, next);
  }
  return { value: entries, end: next + 1 };
}

/** One `key: value` of an object; the key is bare or a quoted string. */
function readField(text: string, from: number): Read<[string, unknown]> {
  const bare = /^[_$a-zA-Z][_$a-zA-Z0-9]*/.exec(text.slice(from, from + 200))?.[0];
  if (text[from] !== '"' && bare === undefined) failAt(text, "a key", from);
  const key = text[from] === '"' ? readString(text, from) : { value: bare ?? "", end: from + (bare ?? "").length };
  const colon = skipSpace(text, key.end);
  if (text[colon] !== ":") failAt(text, "no colon after a key", colon);
  const field = readLiteral(text, colon + 1);
  return { value: [key.value, field.value], end: field.end };
}

function readWord(text: string, start: number): Read {
  const word = /^(void 0|true|false|null|-?\d+(\.\d+)?(e[+-]?\d+)?)/.exec(text.slice(start, start + 40))?.[0];
  if (word === undefined) return failAt(text, "a value these tests do not read", start);
  return { value: word === "void 0" ? undefined : (JSON.parse(word) as unknown), end: start + word.length };
}

/** What SvelteKit's start-up script hands its client (kit 3.2.0 render.js): the loads' results, the form and the error. */
export type Startup = Readonly<{
  node_ids: readonly number[];
  data: readonly ({ readonly type: string; readonly data?: unknown } | null)[];
  form: unknown;
  error: unknown;
}>;

const START = "kit.start(app, element, ";

/**
 * The start-up script's argument, read back, or null for a page with no script at all. A page has at most this one
 * script: a second one, one with a `src`, or one that is not SvelteKit's start-up is an error here.
 */
export function startup(html: string): Startup | null {
  if (scriptCount(html) === 0) return null;
  const [script, ...others] = inlineScripts(html);
  if (script === undefined || others.length > 0 || scriptCount(html) !== 1) {
    throw new Error("start-up data: the page has a script that is not the one start-up script");
  }
  const at = script.indexOf(START);
  if (at === -1 || script.indexOf(START, at + 1) !== -1)
    throw new Error("start-up data: not SvelteKit's start-up script");
  return readLiteral(script, at + START.length).value as Startup;
}

/** The data of node `at` in a page's start-up script (0 the root layout, 1 the page). */
export function startupData(html: string, at: number): unknown {
  const node = startup(html)?.data[at];
  if (node === undefined || node === null || node.type !== "data")
    throw new Error(`start-up data: node ${at} is no data`);
  return node.data;
}

/**
 * The words in `data` that `html` does not show, each as `path: words`: every non-empty string that is neither in the
 * page's text nor the whole value of one of its attributes (a link's address, a tag's content). `switches` names the
 * fields a component only branches on (a card's kind, a layout), which are never a person's words and are not looked
 * for. Rule SE-3: a viewer's data holds what their page shows, so for a page this list is empty.
 */
export function undrawn(data: unknown, html: string, switches: (path: string) => boolean): string[] {
  const { text, attributes } = shownBy(html);
  const missing = leaves(data).flatMap(([path, leaf]) =>
    typeof leaf !== "string" || leaf === "" || switches(path) || text.includes(leaf) || attributes.has(leaf)
      ? []
      : [`${path}: ${leaf}`],
  );
  return [...new Set(missing)].sort();
}
