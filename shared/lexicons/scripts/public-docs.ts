// The documentation of the public lexicons repository (ADR 0089): public-repo/docs/ explains each lexicon, and its
// reference tables and sample records are generated from the files so they cannot drift. A page marks a table with
//
//   <!-- schema:sh.unset.card#main -->
//   ...generated table...
//   <!-- /schema -->
//
// and a sample record from public-repo/examples/ with `<!-- example:examples/sh/unset/card/text.json -->` and
// `<!-- /example -->`. `npm run docs -w shared/lexicons` fills every block; public-docs.test.ts fails when a block
// is out of date or a definition of ours has no table. The style follows standard.site's lexicon pages: overview,
// schema table, example, guidance for writers and readers.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE = join(import.meta.dirname, "..");
/** The root of the public tree's hand-written part: docs/ and examples/ sit here. */
export const PUBLIC = join(PACKAGE, "public-repo");

type Node = Record<string, unknown>;
type Defs = Record<string, Node>;
export type Schema = { nsid: string; defs: Defs };

const BLOCK = /<!-- schema:([A-Za-z0-9.]+)#([A-Za-z0-9]+) -->\n[\s\S]*?<!-- \/schema -->/g;
const EXAMPLE = /<!-- example:(examples\/[A-Za-z0-9/._-]+\.json) -->\n[\s\S]*?<!-- \/example -->/g;
/** The definition kinds a reader needs a table for; tokens, strings and other leaves are described in their parent. */
const DOCUMENTED = new Set(["record", "object", "permission-set"]);

const isObject = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Our schemas, by NSID. */
export function readSchemas(root = PACKAGE): Schema[] {
  return readdirSync(join(root, "schemas"))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      nsid: name.slice(0, -".json".length),
      defs: (JSON.parse(readFileSync(join(root, "schemas", name), "utf8")) as { defs: Defs }).defs,
    }));
}

/** The reference block for one definition, without its markers; undefined when there is no such definition. */
export function reference(nsid: string, name: string, schemas: readonly Schema[]): string | undefined {
  const def = schemas.find((s) => s.nsid === nsid)?.defs[name];
  if (!def) return undefined;
  if (def.type === "permission-set") return permissionTable(def);
  if (def.type === "record" && isObject(def.record))
    return `Record key: \`${String(def.key)}\`\n\n${propertyTable(def.record)}`;
  return def.type === "object" ? propertyTable(def) : undefined;
}

function propertyTable(object: Node): string {
  const required = new Set(Array.isArray(object.required) ? object.required : []);
  const properties = isObject(object.properties) ? object.properties : {};
  const rows = Object.entries(properties).map(([key, value]) => {
    const prop = isObject(value) ? value : {};
    const cells = [`\`${key}\``, typeOf(prop), required.has(key) ? "Yes" : "No", limitsOf(prop)];
    return row([...cells, String(prop.description ?? "")]);
  });
  return [row(["Property", "Type", "Required", "Limits", "Description"]), row(Array(5).fill("---")), ...rows].join(
    "\n",
  );
}

function permissionTable(set: Node): string {
  const permissions = (Array.isArray(set.permissions) ? set.permissions : []).filter(isObject);
  const rows = permissions.flatMap((permission) => {
    const names = permission.resource === "repo" ? permission.collection : permission.lxm;
    const actions = Array.isArray(permission.action) ? permission.action.join(", ") : "create, update, delete";
    const grants = permission.resource === "repo" ? `Records: ${actions}` : "Call the endpoint";
    return (Array.isArray(names) ? names : []).map((name) => row([`\`${String(name)}\``, grants]));
  });
  return [row(["Name", "Grants"]), row(["---", "---"]), ...rows].join("\n");
}

function typeOf(prop: Node): string {
  if (prop.type === "string") return prop.format ? `string (${String(prop.format)})` : "string";
  if (prop.type === "array" && isObject(prop.items)) return `array of ${typeOf(prop.items)}`;
  if (prop.type === "ref") return `\`${String(prop.ref)}\``;
  if (prop.type === "union") {
    const refs = (Array.isArray(prop.refs) ? prop.refs : []).map((ref) => `\`${String(ref)}\``).join(", ");
    return `${prop.closed === true ? "closed" : "open"} union of ${refs}`;
  }
  return String(prop.type);
}

const count = (value: unknown): string => Number(value).toLocaleString("en-US");
const quoted = (values: unknown[]): string => values.map((value) => `\`${String(value)}\``).join(", ");

const present = (parts: readonly string[]): string => parts.filter(Boolean).join("; ");

function limitsOf(prop: Node): string {
  return prop.type === "array" ? arrayLimits(prop) : valueLimits(prop);
}

function arrayLimits(prop: Node): string {
  const each = isObject(prop.items) ? limitsOf(prop.items) : "";
  return present([
    prop.maxLength === undefined ? "" : `up to ${count(prop.maxLength)} items`,
    prop.minLength === undefined ? "" : `at least ${count(prop.minLength)} items`,
    each ? `each: ${each}` : "",
  ]);
}

function valueLimits(prop: Node): string {
  return present([
    prop.maxGraphemes === undefined ? "" : `${count(prop.maxGraphemes)} graphemes`,
    prop.maxLength === undefined ? "" : `${count(prop.maxLength)} bytes`,
    Array.isArray(prop.accept) ? quoted(prop.accept) : "",
    prop.maxSize === undefined ? "" : `up to ${count(prop.maxSize)} bytes`,
    prop.minimum === undefined ? "" : `minimum ${count(prop.minimum)}`,
    prop.maximum === undefined ? "" : `maximum ${count(prop.maximum)}`,
    Array.isArray(prop.knownValues) ? `known values: ${quoted(prop.knownValues)}` : "",
  ]);
}

function row(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`;
}

/** A sample record as a json code fence; undefined when the path leaves examples/ or names no file. */
function example(file: string, root: string): string | undefined {
  const path = join(root, file);
  if (file.split("/").includes("..") || !existsSync(path)) return undefined;
  return `\`\`\`json\n${readFileSync(path, "utf8").trimEnd()}\n\`\`\``;
}

/** `text` with every marked block regenerated; a block naming an unknown definition or file is left as it is. */
export function fill(text: string, schemas: readonly Schema[], root = PUBLIC): string {
  return text
    .replace(BLOCK, (whole, nsid: string, name: string) => {
      const body = reference(nsid, name, schemas);
      return body === undefined ? whole : `<!-- schema:${nsid}#${name} -->\n${body}\n<!-- /schema -->`;
    })
    .replace(EXAMPLE, (whole, file: string) => {
      const body = example(file, root);
      return body === undefined ? whole : `<!-- example:${file} -->\n${body}\n<!-- /example -->`;
    });
}

/** Every Markdown page under `<root>/docs`, as paths from `root`. */
export function docPages(root = PUBLIC): string[] {
  const dir = join(root, "docs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name.split("\\").join("/")}`)
    .sort();
}

/** Blocks that are out of date or name nothing, and definitions of ours that no page documents. */
export function docsProblems(schemas: readonly Schema[], root = PUBLIC): string[] {
  const documented = new Set<string>();
  const problems = docPages(root).flatMap((page) => {
    const text = readFileSync(join(root, page), "utf8");
    const found: string[] = [];
    for (const [, nsid = "", name = ""] of text.matchAll(BLOCK)) {
      documented.add(`${nsid}#${name}`);
      if (reference(nsid, name, schemas) === undefined) found.push(`${page}: ${nsid}#${name} is not a definition here`);
    }
    for (const [, file = ""] of text.matchAll(EXAMPLE))
      if (example(file, root) === undefined) found.push(`${page}: ${file} is not a sample record here`);
    if (fill(text, schemas, root) !== text) found.push(`${page}: a generated block is out of date; run npm run docs`);
    return found;
  });
  for (const { nsid, defs } of schemas)
    for (const [name, def] of Object.entries(defs))
      if (DOCUMENTED.has(String(def.type)) && !documented.has(`${nsid}#${name}`))
        problems.push(`docs/: no page documents ${nsid}#${name}`);
  return problems;
}

if (import.meta.main) {
  const schemas = readSchemas();
  for (const page of docPages()) {
    const path = join(PUBLIC, page);
    const text = readFileSync(path, "utf8");
    const next = fill(text, schemas);
    if (next !== text) writeFileSync(path, next);
  }
  const problems = docsProblems(schemas);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(problems.length > 0 ? 1 : 0);
}
