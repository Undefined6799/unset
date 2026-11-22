import { createHash } from "node:crypto";
import { type FSWatcher, mkdtempSync, readdirSync, readFileSync, rmSync, watch } from "node:fs";
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
const WIDTH = ["defs", "main", "record", "properties", "width"];
/** Problems for one planted schema file, checked alone. */
const planted = (file: SchemaFile): string[] => schemaProblems([file]);
const authFull = () => ours("sh.unset.authFull");
/** The set with a second, create-and-delete entry, as a set that grows has (permission 1). */
const withSecond = (file: SchemaFile) => {
  (setOf(file).permissions as unknown[]).push({
    type: "permission",
    resource: "repo",
    collection: ["sh.unset.like"],
    action: ["create", "delete"],
  });
  return file;
};
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
      "schemas/sh.unset.authFull.json",
      "schemas/sh.unset.block.buttons.json",
      "schemas/sh.unset.block.defs.json",
      "schemas/sh.unset.block.images.json",
      "schemas/sh.unset.block.links.json",
      "schemas/sh.unset.block.showcase.json",
      "schemas/sh.unset.block.text.json",
      "schemas/sh.unset.card.json",
      "schemas/sh.unset.markdownStyle.json",
      "schemas/sh.unset.page.json",
      "schemas/sh.unset.profile.json",
    ]);
    // "object" is not a legal property type (vault lesson lexicon-docs-need-strict-parse-test).
    const objectProp = ours("sh.unset.card");
    put(objectProp, WIDTH, { type: "object" });
    expect(planted(objectProp).join()).toContain("schemas/sh.unset.card.json: invalid lexicon");
    // The parser keeps unknown keys, so a misspelt constraint would silently drop a limit: refused.
    const typo = ours("sh.unset.card");
    put(typo, [...WIDTH, "maxGraphems"], 1);
    expect(planted(typo)).toEqual([
      'schemas/sh.unset.card.json: unknown key "maxGraphems" at defs.main.record.properties.width',
    ]);
  });

  test("nsids_are_flat_or_in_the_block_group", () => {
    // ADR 0086: one group, sh.unset.block; any other group, or a record named like the group, is refused.
    const deep = ours("sh.unset.card");
    deep.file = "schemas/sh.unset.graph.card.json";
    put(deep, ["id"], "sh.unset.graph.card");
    expect(planted(deep)).toEqual([
      "schemas/sh.unset.graph.card.json: id sh.unset.graph.card is not sh.unset.<name> or sh.unset.block.<name>",
    ]);
    const group = ours("sh.unset.card");
    group.file = "schemas/sh.unset.block.json";
    put(group, ["id"], "sh.unset.block");
    expect(planted(group)).toEqual([
      "schemas/sh.unset.block.json: id sh.unset.block is not sh.unset.<name> or sh.unset.block.<name>",
    ]);
    const deeper = ours("sh.unset.card");
    deeper.file = "schemas/sh.unset.block.x.y.json";
    put(deeper, ["id"], "sh.unset.block.x.y");
    expect(planted(deeper)).toEqual([
      "schemas/sh.unset.block.x.y.json: id sh.unset.block.x.y is not sh.unset.<name> or sh.unset.block.<name>",
    ]);
  });

  test("schema_id_matches_filename", () => {
    const moved = ours("sh.unset.card");
    moved.file = "schemas/sh.unset.like.json";
    expect(planted(moved)).toEqual(["schemas/sh.unset.like.json: id sh.unset.card does not match the file name"]);
  });

  test("permission_set_has_en_title_detail", () => {
    // English only until the i18n slice adds French (Alex, 2026-10-15, "English first").
    const main = setOf(authFull());
    for (const key of ["title:lang", "detail:lang"]) expect(Object.keys(main[key] as object)).toEqual(["en"]);
    const noEnglish = authFull();
    delete (setOf(noEnglish)["detail:lang"] as Record<string, string>).en;
    expect(planted(noEnglish)).toEqual(['schemas/sh.unset.authFull.json: permission set has no "en" detail']);
  });

  test("permission_set_scope_prefix_only", () => {
    const foreign = authFull();
    (setOf(foreign).permissions as unknown[]).push({
      type: "permission",
      resource: "repo",
      collection: ["app.bsky.feed.post"],
    });
    expect(planted(foreign)).toEqual([
      "schemas/sh.unset.authFull.json: permission 1 names app.bsky.feed.post outside sh.unset.",
    ]);
    const blob = authFull();
    (setOf(blob).permissions as unknown[]).push({ type: "permission", resource: "blob", accept: ["image/*"] });
    expect(planted(blob)).toEqual([
      'schemas/sh.unset.authFull.json: permission 1 has resource "blob"; only repo and rpc',
    ]);
    const wildcard = authFull();
    (setOf(wildcard).permissions as unknown[]).push({ type: "permission", resource: "repo", collection: ["*"] });
    expect(planted(wildcard)).toEqual(["schemas/sh.unset.authFull.json: permission 1 names * outside sh.unset."]);
  });

  test("permission_set_rpc_no_fixed_aud", () => {
    const fixed = authFull();
    const rpc = { type: "permission", resource: "rpc", lxm: ["sh.unset.getThing"] };
    (setOf(fixed).permissions as unknown[]).push({ ...rpc, aud: "did:web:api.unset.sh#unset_api" });
    expect(planted(fixed)).toEqual([
      "schemas/sh.unset.authFull.json: permission 1 has a fixed aud; rpc entries use inheritAud",
    ]);
    const inherits = authFull();
    (setOf(inherits).permissions as unknown[]).push({ ...rpc, inheritAud: true });
    expect(planted(inherits)).toEqual([]);
    // Without inheritAud the server drops the entry (@atproto/oauth-scopes include-scope.js parseLexPermission).
    const neither = authFull();
    (setOf(neither).permissions as unknown[]).push(rpc);
    expect(planted(neither)).toEqual(["schemas/sh.unset.authFull.json: permission 1 does not set inheritAud: true"]);
  });

  test("permission_entry_keys_exact", () => {
    // A misspelt key is kept by the parser and dropped by the server, so `acton` would turn a create/delete-only entry
    // into one that allows every action, widening every existing grant at its next refresh.
    const typo = withSecond(authFull());
    const follow = (setOf(typo).permissions as Record<string, unknown>[]).find(
      (p) => p.resource === "repo" && p.action,
    );
    if (follow === undefined) throw new Error("the set has no repo entry with actions");
    follow.acton = follow.action;
    delete follow.action;
    expect(planted(typo)).toEqual(['schemas/sh.unset.authFull.json: permission 1 has unknown key "acton"']);
    const rpcExtra = authFull();
    (setOf(rpcExtra).permissions as unknown[]).push({
      type: "permission",
      resource: "rpc",
      lxm: ["sh.unset.getThing"],
      inheritAud: true,
      collection: ["sh.unset.profile"],
    });
    expect(planted(rpcExtra)).toEqual(['schemas/sh.unset.authFull.json: permission 1 has unknown key "collection"']);
  });

  test("permission_values_valid", () => {
    // The server drops an entry whose values do not parse (atproto.com/specs/lexicon#permission), so a typo would
    // silently remove a grant: actions must be create, update or delete, lists non-empty and unique, NSIDs flat.
    const cases: [Record<string, unknown>, string][] = [
      [{ action: ["create", "delet"] }, 'permission 1 has action "delet"; only create, update and delete'],
      [{ action: [] }, "permission 1 has an empty action list"],
      [{ action: ["create", "create"] }, 'permission 1 lists "create" twice'],
      [{ collection: [] }, "permission 1 has an empty collection list"],
      [{ collection: ["sh.unset.like", "sh.unset.like"] }, 'permission 1 lists "sh.unset.like" twice'],
      [{ collection: ["sh.unset.foo.bar"] }, "permission 1 names sh.unset.foo.bar, not a flat sh.unset.<name> NSID"],
    ];
    for (const [change, problem] of cases) {
      const file = withSecond(authFull());
      const follow = (setOf(file).permissions as Record<string, unknown>[])[1];
      if (follow === undefined) throw new Error("the set has no second entry");
      Object.assign(follow, change);
      expect(planted(file), JSON.stringify(change)).toEqual([`schemas/sh.unset.authFull.json: ${problem}`]);
    }
  });

  test("schema_file_names_unique", () => {
    // schemas/ and vendor/ are copied into one folder for `lex build`; a shared name would let one silently win.
    const twin = { ...ours("sh.unset.card"), file: "vendor/sh.unset.card.json", ours: false };
    expect(schemaProblems([ours("sh.unset.card"), twin])).toContain(
      "vendor/sh.unset.card.json: sh.unset.card.json is also in schemas/",
    );
  });

  test("first_set_covers_the_profile_its_pages_and_cards_only", () => {
    // ADR 0086 (Alex, 2026-11-21): follows left the first set; a feature that writes another record adds it later.
    // ADR 0091 added the page.
    expect(setOf(authFull()).permissions).toEqual([
      { type: "permission", resource: "repo", collection: ["sh.unset.profile", "sh.unset.page", "sh.unset.card"] },
    ]);
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
    // The build runs with a temp folder of its own: the system one is shared with every other process, and another
    // checkout's test run building there at the same time added its folders to this one's (P1.38w). Off Windows,
    // os.tmpdir() asks libuv on each call, which reads TMPDIR first (Node v26.x lib/os.js; libuv misc.rst).
    const temp = mkdtempSync(join(tmpdir(), "lexicons-build-test-"));
    const outer = process.env.TMPDIR;
    process.env.TMPDIR = temp;
    try {
      const touched = await entriesTouched([...shared, temp], () => generatedDrift());
      underShared = touched.filter((path) => !relative(join(REPO, "shared"), path).startsWith(".."));
      inTemp = touched.filter((path) => dirname(path) === temp);
    } finally {
      if (outer === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = outer;
      rmSync(temp, { recursive: true, force: true });
    }
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
