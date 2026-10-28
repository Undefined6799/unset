// The endpoint pages match the generator (P0.09, issue #1161). A route change that does not
// regenerate the pages fails here, and this file is part of npm test.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  type Bucket,
  checkEndpoints,
  loadEndpointModel,
  NOT_RECORDED,
  type ProcessModel,
  type RouteRecord,
  renderEndpointFiles,
  writeEndpoints,
} from "./endpoints.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function route(over: Pick<RouteRecord, "method" | "path"> & Partial<RouteRecord>): RouteRecord {
  return {
    group: "app",
    requiresSession: null,
    handlerSession: null,
    middleware: ["requestId", "methodCheck"],
    rateLimit: "default",
    accepts: [],
    bodyLimit: null,
    mutates: false,
    deadlineMs: null,
    why: "why",
    input: "input",
    output: "output",
    errors: "errors",
    auth: "auth",
    ...over,
  };
}

function pageOf(process: ProcessModel): string {
  const text = renderEndpointFiles({ processes: [process] }).get(`docs/site/content/endpoints/${process.name}.md`);
  if (text === undefined) throw new Error("no page");
  return text;
}

function rowFor(page: string, method: string, path: string): string {
  const line = page.split("\n").find((item) => item.startsWith(`| ${method} | \`${path}\` |`));
  if (line === undefined) throw new Error(`no row ${method} ${path}`);
  return line;
}

const policies = new Map<string, readonly Bucket[]>([["default", [{ scope: "ip", capacity: 60, refillPerSec: 5 }]]]);

test("endpoint_pages_match_manifests", async () => {
  expect(await checkEndpoints(ROOT)).toEqual([]);
});

test("http_policies_match_limits_ts", async () => {
  const loaded = await loadEndpointModel(ROOT);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const http = loaded.model.processes.find((process) => process.name === "http");
  const indexer = loaded.model.processes.find((process) => process.name === "indexer");
  expect(http?.policies?.get("default")).toEqual([
    { scope: "ip", capacity: 60, refillPerSec: 5 },
    { scope: "global", capacity: 3000, refillPerSec: 50 },
  ]);
  expect(http?.policies?.get("login")).toEqual([{ scope: "ip", capacity: 10, refillPerSec: 10 / 60 }]);
  expect(indexer?.policies).toBeNull();
});

describe("endpoint cells", () => {
  test("session_csrf_and_buckets_come_only_from_recorded_fields", () => {
    const page = pageOf({
      name: "http",
      policies,
      routes: [
        route({ method: "GET", path: "/open", requiresSession: null, middleware: ["requestId"], rateLimit: "default" }),
        route({
          method: "GET",
          path: "/closed",
          requiresSession: true,
          middleware: ["requestId", "session"],
          rateLimit: "exempt",
        }),
        route({
          method: "GET",
          path: "/gated",
          handlerSession: true,
          middleware: ["requestId"],
          rateLimit: "exempt",
        }),
        route({
          method: "POST",
          path: "/save",
          middleware: ["requestId", "csrf"],
          accepts: ["application/x-www-form-urlencoded"],
          bodyLimit: 2048,
          mutates: true,
        }),
        route({
          method: "GET",
          path: "/bare",
          middleware: null,
          rateLimit: null,
          accepts: null,
          group: null,
          mutates: null,
        }),
      ],
    });
    const open = rowFor(page, "GET", "/open");
    expect(open).toContain(`| ${NOT_RECORDED} | no | default | ip: capacity 60, refillPerSec 5 |`);
    expect(rowFor(page, "GET", "/closed")).toContain("| required | no | exempt | not recorded |");
    // #1279: the handler, not the kit, sends a signed-out visitor to /login.
    expect(rowFor(page, "GET", "/gated")).toContain("| required (handler) | no | exempt | not recorded |");
    expect(rowFor(page, "POST", "/save")).toContain("| yes | default |");
    expect(rowFor(page, "POST", "/save")).toContain("| 2048 | yes |");
    const bare = rowFor(page, "GET", "/bare");
    expect(bare).toContain(`| ${NOT_RECORDED} | ${NOT_RECORDED} | ${NOT_RECORDED} | ${NOT_RECORDED} |`);
  });
});

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "endpoints-"));
  dirs.push(root);
  mkdirSync(join(root, "interfaces/demo"), { recursive: true });
  mkdirSync(join(root, "docs/site/data/endpoints"), { recursive: true });
  return root;
}

const HEALTH = {
  method: "GET",
  path: "/health",
  group: "static",
  accepts: [],
  rateLimit: "exempt",
  mutates: false,
  middleware: ["requestId", "methodCheck"],
};

describe("endpoint inputs", () => {
  test("missing_and_orphan_keys_fail", async () => {
    const root = tempRepo();
    writeFileSync(join(root, "interfaces/demo/routes.manifest.json"), JSON.stringify([HEALTH]));
    writeFileSync(join(root, "docs/site/data/endpoints/demo.yaml"), '"POST /extra":\n  why: "no"\n');
    const loaded = await loadEndpointModel(root);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.problems).toEqual([
      'docs/site/data/endpoints/demo.yaml: missing key "GET /health"',
      'docs/site/data/endpoints/demo.yaml: orphan key "POST /extra"',
    ]);
  });

  test("handler_session_is_read_only_as_true", async () => {
    const root = tempRepo();
    const gated = { ...HEALTH, path: "/gated", handlerSession: true };
    const bad = { ...HEALTH, path: "/bad", handlerSession: "yes" };
    const both = { ...HEALTH, path: "/both", handlerSession: true, requiresSession: true };
    writeFileSync(join(root, "interfaces/demo/routes.manifest.json"), JSON.stringify([gated, bad, both]));
    writeFileSync(
      join(root, "docs/site/data/endpoints/demo.yaml"),
      '"GET /gated": {}\n"GET /bad": {}\n"GET /both": {}\n',
    );
    const loaded = await loadEndpointModel(root);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.problems).toEqual([
      "interfaces/demo/routes.manifest.json: GET /bad handlerSession is not true",
      "interfaces/demo/routes.manifest.json: GET /both sets both requiresSession and handlerSession",
    ]);
  });

  test("check_fails_when_a_page_is_edited", async () => {
    const root = tempRepo();
    writeFileSync(join(root, "interfaces/demo/routes.manifest.json"), JSON.stringify([HEALTH]));
    writeFileSync(join(root, "docs/site/data/endpoints/demo.yaml"), '"GET /health":\n  why: "probe"\n');
    expect(await writeEndpoints(root)).toEqual([]);
    const page = join(root, "docs/site/content/endpoints/demo.md");
    writeFileSync(page, readFileSync(page, "utf8").replace("probe", "changed"));
    expect(await checkEndpoints(root)).toEqual(["docs/site/content/endpoints/demo.md differs from the generator"]);
  });

  test("a_named_policy_without_limits_ts_fails", async () => {
    const root = tempRepo();
    writeFileSync(
      join(root, "interfaces/demo/routes.manifest.json"),
      JSON.stringify([{ ...HEALTH, rateLimit: "default", group: "app" }]),
    );
    writeFileSync(join(root, "docs/site/data/endpoints/demo.yaml"), '"GET /health": {}\n');
    const loaded = await loadEndpointModel(root);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.problems).toEqual([
      'interfaces/demo/limits.ts: GET /health names "default" but the file does not exist',
    ]);
  });
});
