// A page's data address (book P1.22h): SvelteKit answers `<page>/__data.json` for every page route with the result of
// its server loads, whatever `csr` says, so the address is served for pages that run no script too (kit 3.2.0
// src/runtime/server/respond.js `is_data_request`, data/index.js `render_data`). The answer is JSON: one node per
// layout and page, each `data` (devalue's flat form), `skip` (the client asked to leave it out with
// `?x-sveltekit-invalidated=`), an error with a code, or null for a page with no server load; a redirect is its own
// answer. A missing page is an error node under status 200, so the tests read the node, never the status alone.
// These helpers read an answer back and hold it against the page the same viewer gets (rule SE-3).
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
  attrs?: readonly Readonly<{ value: string }>[];
  childNodes?: readonly HtmlNode[];
  content?: HtmlNode;
  value?: string;
}>;

/** What a page shows: all of its text run together, and every attribute's value. */
function shownBy(html: string): { text: string; attributes: Set<string> } {
  const attributes = new Set<string>();
  let text = "";
  const walk = (node: HtmlNode): void => {
    for (const attribute of node.attrs ?? []) attributes.add(attribute.value);
    if (node.value !== undefined) text += node.value;
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content !== undefined) walk(node.content);
  };
  walk(parse(html) as HtmlNode);
  return { text, attributes };
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
