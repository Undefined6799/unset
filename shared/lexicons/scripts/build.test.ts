import { createHash } from "node:crypto";
import { type FSWatcher, readdirSync, readFileSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { generatedDrift, readSchemas, type SchemaFile, schemaProblems } from "./build.ts";

const schemas = readSchemas();
const ours = (id: string): SchemaFile => {
  const found = schemas.find((s) => s.file === `schemas/${id}.json`);
  if (!found) throw new Error(`no schema ${id}`);
  return structuredClone(found);
};
/** Sets one value inside a planted schema, by key path. */
function put(file: SchemaFile, path: string[], value: unknown): void {
  let node = file.doc as Record<string, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[path.at(-1) as string] = value;
}
const SUBJECT = ["defs", "main", "record", "properties", "subject"];
/** Problems for one planted schema file, checked alone. */
const planted = (file: SchemaFile): string[] => schemaProblems([file]);
const authApp = () => ours("sh.unset.authApp");
const setOf = (file: SchemaFile) => (file.doc as { defs: { main: Record<string, unknown> } }).defs.main;

describe("schema build checks", () => {
  test("every_schema_parses_strict", () => {
    expect(schemaProblems(schemas)).toEqual([]);
    expect(
      schemas
        .filter((s) => s.ours)
        .map((s) => s.file)
        .sort(),
    ).toEqual([
      "schemas/sh.unset.authApp.json",
      "schemas/sh.unset.follow.json",
      "schemas/sh.unset.profile.json",
      "schemas/sh.unset.section.json",
    ]);
    // "object" is not a legal property type (vault lesson lexicon-docs-need-strict-parse-test).
    const objectProp = ours("sh.unset.follow");
    put(objectProp, SUBJECT, { type: "object" });
    expect(planted(objectProp).join()).toContain("schemas/sh.unset.follow.json: invalid lexicon");
    // The parser keeps unknown keys, so a misspelt constraint would silently drop a limit: refused.
    const typo = ours("sh.unset.follow");
    put(typo, [...SUBJECT, "maxGraphems"], 1);
    expect(planted(typo)).toEqual([
      'schemas/sh.unset.follow.json: unknown key "maxGraphems" at defs.main.record.properties.subject',
    ]);
  });

  test("nsids_are_flat", () => {
    const deep = ours("sh.unset.follow");
    deep.file = "schemas/sh.unset.graph.follow.json";
    put(deep, ["id"], "sh.unset.graph.follow");
    expect(planted(deep)).toEqual([
      "schemas/sh.unset.graph.follow.json: id sh.unset.graph.follow is not a flat sh.unset.<name> NSID",
    ]);
  });

  test("schema_id_matches_filename", () => {
    const moved = ours("sh.unset.follow");
    moved.file = "schemas/sh.unset.like.json";
    expect(planted(moved)).toEqual(["schemas/sh.unset.like.json: id sh.unset.follow does not match the file name"]);
  });

  test("permission_set_has_en_title_detail", () => {
    // English only until the i18n slice adds French (Alex, 2026-10-15, "English first").
    const main = setOf(authApp());
    for (const key of ["title:lang", "detail:lang"]) expect(Object.keys(main[key] as object)).toEqual(["en"]);
    const noEnglish = authApp();
    delete (setOf(noEnglish)["detail:lang"] as Record<string, string>).en;
    expect(planted(noEnglish)).toEqual(['schemas/sh.unset.authApp.json: permission set has no "en" detail']);
  });

  test("permission_set_scope_prefix_only", () => {
    const foreign = authApp();
    (setOf(foreign).permissions as unknown[]).push({
      type: "permission",
      resource: "repo",
      collection: ["app.bsky.feed.post"],
    });
    expect(planted(foreign)).toEqual([
      "schemas/sh.unset.authApp.json: permission 2 names app.bsky.feed.post outside sh.unset.",
    ]);
    const blob = authApp();
    (setOf(blob).permissions as unknown[]).push({ type: "permission", resource: "blob", accept: ["image/*"] });
    expect(planted(blob)).toEqual([
      'schemas/sh.unset.authApp.json: permission 2 has resource "blob"; only repo and rpc',
    ]);
    const wildcard = authApp();
    (setOf(wildcard).permissions as unknown[]).push({ type: "permission", resource: "repo", collection: ["*"] });
    expect(planted(wildcard)).toEqual(["schemas/sh.unset.authApp.json: permission 2 names * outside sh.unset."]);
  });

  test("permission_set_rpc_no_fixed_aud", () => {
    const fixed = authApp();
    const rpc = { type: "permission", resource: "rpc", lxm: ["sh.unset.getThing"] };
    (setOf(fixed).permissions as unknown[]).push({ ...rpc, aud: "did:web:api.unset.sh#unset_api" });
    expect(planted(fixed)).toEqual([
      "schemas/sh.unset.authApp.json: permission 2 has a fixed aud; rpc entries use inheritAud",
    ]);
    const inherits = authApp();
    (setOf(inherits).permissions as unknown[]).push({ ...rpc, inheritAud: true });
    expect(planted(inherits)).toEqual([]);
    // Without inheritAud the server drops the entry (@atproto/oauth-scopes include-scope.js parseLexPermission).
    const neither = authApp();
    (setOf(neither).permissions as unknown[]).push(rpc);
    expect(planted(neither)).toEqual(["schemas/sh.unset.authApp.json: permission 2 does not set inheritAud: true"]);
  });

  test("permission_entry_keys_exact", () => {
    // A misspelt key is kept by the parser and dropped by the server, so `acton` would turn a create/delete-only entry
    // into one that allows every action, widening every existing grant at its next refresh.
    const typo = authApp();
    const follow = (setOf(typo).permissions as Record<string, unknown>[]).find(
      (p) => p.resource === "repo" && p.action,
    );
    if (follow === undefined) throw new Error("the set has no repo entry with actions");
    follow.acton = follow.action;
    delete follow.action;
    expect(planted(typo)).toEqual(['schemas/sh.unset.authApp.json: permission 1 has unknown key "acton"']);
    const rpcExtra = authApp();
    (setOf(rpcExtra).permissions as unknown[]).push({
      type: "permission",
      resource: "rpc",
      lxm: ["sh.unset.getThing"],
      inheritAud: true,
      collection: ["sh.unset.profile"],
    });
    expect(planted(rpcExtra)).toEqual(['schemas/sh.unset.authApp.json: permission 2 has unknown key "collection"']);
  });

  test("permission_values_valid", () => {
    // The server drops an entry whose values do not parse (atproto.com/specs/lexicon#permission), so a typo would
    // silently remove a grant: actions must be create, update or delete, lists non-empty and unique, NSIDs flat.
    const cases: [Record<string, unknown>, string][] = [
      [{ action: ["create", "delet"] }, 'permission 1 has action "delet"; only create, update and delete'],
      [{ action: [] }, "permission 1 has an empty action list"],
      [{ action: ["create", "create"] }, 'permission 1 lists "create" twice'],
      [{ collection: [] }, "permission 1 has an empty collection list"],
      [{ collection: ["sh.unset.follow", "sh.unset.follow"] }, 'permission 1 lists "sh.unset.follow" twice'],
      [{ collection: ["sh.unset.foo.bar"] }, "permission 1 names sh.unset.foo.bar, not a flat sh.unset.<name> NSID"],
    ];
    for (const [change, problem] of cases) {
      const file = authApp();
      const follow = (setOf(file).permissions as Record<string, unknown>[])[1];
      if (follow === undefined) throw new Error("the set has no second entry");
      Object.assign(follow, change);
      expect(planted(file), JSON.stringify(change)).toEqual([`schemas/sh.unset.authApp.json: ${problem}`]);
    }
  });

  test("schema_file_names_unique", () => {
    // schemas/ and vendor/ are copied into one folder for `lex build`; a shared name would let one silently win.
    const twin = { ...ours("sh.unset.follow"), file: "vendor/sh.unset.follow.json", ours: false };
    expect(schemaProblems([ours("sh.unset.follow"), twin])).toContain(
      "vendor/sh.unset.follow.json: sh.unset.follow.json is also in schemas/",
    );
  });

  test("follow_schema_in_first_set", () => {
    // Answer 29b: sh.unset.follow is in the set from its first publication, create and delete only.
    expect(setOf(authApp()).permissions).toContainEqual({
      type: "permission",
      resource: "repo",
      collection: ["sh.unset.follow"],
      action: ["create", "delete"],
    });
  });

  test("generated_types_current", { timeout: 60_000 }, () => {
    expect(generatedDrift()).toEqual([]);
  });
});

const REPO = join(import.meta.dirname, "..", "..", "..");

/** Every folder under `dir`, itself included; node_modules is installed, not ours. */
function folders(dir: string): string[] {
  const below = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .flatMap((entry) => folders(join(dir, entry.name)));
  return [dir, ...below];
}

/** The entries created or removed in each watched folder while `run` runs, as absolute paths. */
async function entriesTouched(dirs: string[], run: () => void): Promise<string[]> {
  const touched = new Set<string>();
  const watchers: FSWatcher[] = dirs.map((dir) =>
    watch(dir, (event, name) => {
      if (event === "rename" && name) touched.add(join(dir, name));
    }),
  );
  try {
    run();
    // inotify events queued during the synchronous build arrive on the next turns of the event loop.
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    for (const watcher of watchers) watcher.close();
  }
  return [...touched];
}

describe("lexicon build output folder", () => {
  // A docs test walks shared/ while this build runs (verify-1113-931b44c), so the build may not write there.
  let underShared: string[] = [];
  let inTemp: string[] = [];
  beforeAll(async () => {
    const shared = folders(join(REPO, "shared"));
    const touched = await entriesTouched([...shared, tmpdir()], () => generatedDrift());
    underShared = touched.filter((path) => !relative(join(REPO, "shared"), path).startsWith(".."));
    inTemp = touched.filter((path) => dirname(path) === tmpdir());
  }, 60_000);

  test("generate_writes_nothing_under_shared", () => {
    expect(underShared).toEqual([]);
  });

  test("generate_builds_outside_the_repo", () => {
    const builds = inTemp.filter((path) => path.split("/").at(-1)?.startsWith("unset-lexicons-"));
    expect(builds).toHaveLength(1);
    const fromRepo = relative(REPO, builds[0] ?? REPO);
    expect(fromRepo.startsWith("..") || isAbsolute(fromRepo), fromRepo).toBe(true);
  });
});

describe("vendored lexicons", () => {
  test("vendor_files_pinned", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "vendor", "SOURCE.md"), "utf8");
    const pinned = new Map([...source.matchAll(/^\| (\S+\.json) \| ([0-9a-f]{64}) \|$/gm)].map((m) => [m[1], m[2]]));
    const vendored = schemas.filter((s) => !s.ours).map((s) => s.file.slice("vendor/".length));
    expect([...pinned.keys()].sort()).toEqual(vendored.sort());
    for (const [file, hash] of pinned) {
      const value = JSON.stringify(
        JSON.parse(readFileSync(join(import.meta.dirname, "..", "vendor", file ?? ""), "utf8")),
      );
      expect(createHash("sha256").update(value).digest("hex"), file).toBe(hash);
    }
  });
});
