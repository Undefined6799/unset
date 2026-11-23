// The endpoint pages must describe the live route tree and fail on drift (P1.20y).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { checkEndpoints, loadEndpointModel, renderEndpointFiles, writeEndpoints } from "./endpoints.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const ROUTES = "interfaces/web/src/routes";
const LIMITS = "interfaces/web/src/lib/server/limits.ts";
const PAGE = "docs/site/content/endpoints/web.md";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function put(root: string, file: string, text: string): void {
  const path = join(root, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "endpoints-"));
  dirs.push(root);
  put(root, "package.json", '{"type":"module"}');
  put(root, LIMITS, 'export const policies = { default: [{ scope: "ip", capacity: 60, refillPerSec: 5 }] };');
  addRoute(root, "/", 'export const GET = () => new Response("ok");');
  return root;
}

function addRoute(root: string, id: string, handler: string, policy = '{ group: "public", limit: "default" }') {
  put(root, `${ROUTES}${id}/policy.ts`, `export const policy = ${policy};`);
  put(root, `${ROUTES}${id}/+server.ts`, handler);
}

async function page(root: string): Promise<string> {
  const loaded = await loadEndpointModel(root);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.problems.join("\n"));
  return renderEndpointFiles(loaded.model).get(PAGE) ?? "";
}

test("endpoint_pages_match_every_route_policy", async () => {
  const expected = readdirSync(join(ROOT, ROUTES), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "policy.ts")
    .map((entry) => `${entry.parentPath.slice(join(ROOT, ROUTES).length) || "/"}`)
    .sort();
  expect(expected.length).toBeGreaterThan(0);
  const loaded = await loadEndpointModel(ROOT);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.problems.join("\n"));
  expect(loaded.model.processes.map((process) => process.name)).toEqual(["web"]);
  expect(loaded.model.processes[0]?.routes.map((route) => route.path).sort()).toEqual(expected);
  expect(await checkEndpoints(ROOT)).toEqual([]);
});

test("empty_route_tree_fails_instead_of_producing_an_empty_page", async () => {
  const root = fixture();
  rmSync(join(root, ROUTES), { recursive: true });
  expect(await loadEndpointModel(root)).toMatchObject({ ok: false });
});

test("policy_fields_and_methods_are_read_without_importing_handlers", async () => {
  const root = fixture();
  addRoute(
    root,
    "/test-only",
    'throw new Error("never import handlers"); export function GET() {}',
    '{ group: "app", limit: "default", writeLimit: "default", session: "writes", maxBody: 2048, deadlineMs: 500, testOnly: true }',
  );
  put(root, `${ROUTES}/test-only/+page.server.ts`, "const save = {}; export { save as actions };");
  const text = await page(root);
  expect(text).toContain(
    "| GET, POST | `/test-only` | app | writes | default | ip: capacity 60, refillPerSec 5 | default | ip: capacity 60, refillPerSec 5 | 2048 | 500 | yes |",
  );
  expect(text).toContain(
    "| GET | `/` | public | not recorded | default | ip: capacity 60, refillPerSec 5 | not recorded | not recorded | not recorded | not recorded | not recorded |",
  );
  expect(text).toContain("| not recorded | not recorded | not recorded | not recorded | not recorded |");
});

// A public page that runs SvelteKit's client (ADR 0114; policy.ts `client`) says so beside its group.
test("a_public_page_that_runs_the_client_says_so_in_its_group", async () => {
  const root = fixture();
  const handler = 'export const GET = () => new Response("ok");';
  addRoute(root, "/shown", handler, '{ group: "public", client: true, limit: "default" }');
  expect(await page(root)).toContain("| GET | `/shown` | public, runs the client | not recorded | default |");
  addRoute(root, "/odd", handler, '{ group: "public", client: "yes", limit: "default" }');
  expect(await loadEndpointModel(root)).toEqual({
    ok: false,
    problems: [`${ROUTES}/odd/policy.ts client is not true`],
  });
});

test("page_components_add_get_and_comments_do_not_add_methods", async () => {
  const root = fixture();
  addRoute(root, "/form", "// export const DELETE = () => {};\nconst post = () => {}; export { post as POST };");
  put(root, `${ROUTES}/form/+page.svelte`, "<p>Example</p>");
  expect(await page(root)).toContain("| GET, POST | `/form` |");
});

test("missing_policy_fails_even_when_another_route_is_recorded", async () => {
  const root = fixture();
  put(root, `${ROUTES}/missing/+page.svelte`, "<p>Example</p>");
  expect(await checkEndpoints(root)).toContain(`${ROUTES}/missing/policy.ts: missing`);
});

test.each(["limit", "writeLimit"])("unknown_%s_name_fails", async (field) => {
  const root = fixture();
  addRoute(
    root,
    "/unknown",
    "export const POST = () => {};",
    `{ group: "app", limit: "default", ${field}: "unknown" }`,
  );
  expect(await checkEndpoints(root)).toContain(
    `${LIMITS}: POST /unknown names "unknown" but no such policy is exported`,
  );
});

test("check_fails_after_hand_edit_or_a_new_route_without_regeneration", async () => {
  const root = fixture();
  expect(await writeEndpoints(root)).toEqual([]);
  expect(await checkEndpoints(root)).toEqual([]);
  const original = readFileSync(join(root, PAGE), "utf8");
  put(root, PAGE, `${original}\nHand edit\n`);
  expect(await checkEndpoints(root)).toContain(`${PAGE} differs from the generator`);
  put(root, PAGE, original);
  addRoute(root, "/new", "export const GET = () => {};");
  expect(await checkEndpoints(root)).toContain(`${PAGE} differs from the generator`);
});

test("prose_is_optional_but_invalid_or_orphan_prose_still_fails", async () => {
  const root = fixture();
  put(root, "docs/site/data/endpoints/web.yaml", '"GET /extra":\n  why: "unused"\n');
  expect(await checkEndpoints(root)).toContain('docs/site/data/endpoints/web.yaml: orphan key "GET /extra"');
  put(root, "docs/site/data/endpoints/web.yaml", '"GET /":\n  why: "bad | cell"\n');
  expect(await checkEndpoints(root)).toContain(
    'docs/site/data/endpoints/web.yaml: "GET /" why must be one line without a pipe',
  );
});
