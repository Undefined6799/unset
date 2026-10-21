// MIT upstream UI0.10.5 original fixtures, pinned atproto a7c8604d876a200a1e4fa4aec83d4189ac4f1c12.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { archive, sha256 } from "./archive.ts";
import { tar } from "./fixtures/native.ts";
import { canonical, exactPatch, patchManifest, planPatches } from "./source-patches.ts";

const revision = "a7c8604d876a200a1e4fa4aec83d4189ac4f1c12";
const originals: Record<string, string> = JSON.parse(
  readFileSync(new URL("./fixtures/patch-targets.json", import.meta.url), "utf8"),
);
const prefix = "deployment/pds/patches/ui/";
const json = (x: unknown): Buffer => Buffer.from(canonical(x));
const target = Object.keys(originals).sort()[0] as string;
const patch = (path: string, body: string) => Buffer.from(`--- a/${path}\n+++ b/${path}\n${body}`);
function cohort() {
  const inputs = new Map<string, Buffer>();
  const rows = Object.keys(originals)
    .sort()
    .map((path, i) => {
      const original = originals[path] as string;
      const first = original.split("\n")[0] as string;
      const bytes = patch(path, `@@ -1,1 +1,2 @@\n ${first}\n+// fixture ${i}\n`);
      const output = original.replace(`${first}\n`, `${first}\n// fixture ${i}\n`);
      inputs.set(`${prefix}target-${i}.patch`, bytes);
      return {
        patch: `target-${i}.patch`,
        target: path,
        inputSha256: sha256(original),
        outputSha256: sha256(output),
        patchSha256: sha256(bytes),
      };
    });
  inputs.set(`${prefix}manifest.json`, json({ schema: 1, patches: rows }));
  return { inputs, rows };
}
async function source() {
  return archive(
    await tar(Object.entries(originals).map(([name, body]) => ({ name: `atproto-${revision}/${name}`, body }))),
  );
}

test("patch_json_has_one_key_order_encoding_and_rejects_duplicates", () => {
  expect(canonical({ schema: 1, patches: [] })).toBe('{\n  "patches": [],\n  "schema": 1\n}\n');
  expect(patchManifest(json({ schema: 1, patches: [] }))).toEqual([]);
  for (const bytes of [
    Buffer.from('{"schema":1,"schema":1,"patches":[]}\n'),
    Buffer.from('{\n  "schema": 1,\n  "patches": []\n}\n'),
    json({ schema: 1, patches: [], extra: 1 }),
    json(null),
    json({ schema: 1, patches: {} }),
  ]) {
    expect(() => patchManifest(bytes)).toThrow();
  }
});

test("exact_patch_reconstructs_two_hunks_without_search_or_normalization", () => {
  const original = Buffer.from("same\nα\nsame\ntail\n");
  const diff = patch(target, "@@ -1,2 +1,3 @@\n same\n-α\n+β\n+extra\n@@ -4,1 +5,1 @@\n-tail\n+end\n");
  expect(exactPatch(original, diff, target).toString()).toBe("same\nβ\nextra\nsame\nend\n");
  expect(original.toString()).toBe("same\nα\nsame\ntail\n");
});

test.each([
  "@@ -2,1 +2,1 @@\n-same\n+other\n", // same context exists elsewhere: never search ahead
  "@@ -1,2 +1,1 @@\n-same\n+other\n",
  "@@ -1,1 +2,1 @@\n-same\n+other\n",
  "@@ -0,1 +1,1 @@\n-same\n+other\n",
  "@@ -01,1 +1,1 @@\n-same\n+other\n",
  "@@ -9007199254740992,1 +1,1 @@\n-same\n+other\n",
  "@@ -1,1 +1,1 @@ function\n-same\n+other\n",
  "@@ -1,1 +1,1 @@\n same\n",
  "@@ -1,1 +1,1 @@\n-same\n+other\n@@ -1,1 +1,1 @@\n-same\n+again\n",
  "@@ -1,1 +1,1 @@\n-same\n+other", // no LF
  "@@ -1,1 +1,1 @@\r\n-same\n+other\n",
  "@@ -1,1 +1,1 @@\n-same\n+other\ntrailing\n",
  "@@ -1,1 +1,1 @@\n-same\n+other\n--- a/other\n+++ b/other\n",
])("exact_patch_rejects_malformed_or_offset_hunks: %s", (body) => {
  expect(() => exactPatch(Buffer.from("same\nα\nsame\ntail\n"), patch(target, body), target)).toThrow();
});

test("patch_cohort_uses_exact_archive_bytes_and_never_writes_on_late_failure", async () => {
  const files = await source();
  const { inputs, rows } = cohort();
  const before = [...files].map(([name, entry]) => [name, Buffer.from(entry.data)] as const);
  const planned = planPatches(files, revision, inputs);
  expect(planned.size).toBe(3);
  for (const bytes of planned.values()) expect(bytes.toString()).toContain("// fixture ");
  inputs.set(
    `${prefix}manifest.json`,
    json({ schema: 1, patches: rows.map((r, i) => (i === 2 ? { ...r, outputSha256: "0".repeat(64) } : r)) }),
  );
  expect(() => planPatches(files, revision, inputs)).toThrow();
  for (const [name, bytes] of before) expect(files.get(name)?.data).toEqual(bytes);
});

test("patch_cohort_rejects_partial_unknown_duplicate_and_hash_lies", async () => {
  const files = await source();
  const { inputs, rows } = cohort();
  for (const bad of [
    rows.slice(0, 1),
    rows.slice(0, 2),
    [...rows].reverse(),
    [rows[0], rows[0], rows[2]],
    rows.map((r, i) => (i === 2 ? { ...r, patch: rows[0]?.patch } : r)),
    rows.map((r, i) => (i === 2 ? { ...r, inputSha256: "0".repeat(64) } : r)),
    rows.map((r, i) => (i === 2 ? { ...r, patchSha256: "0".repeat(64) } : r)),
    rows.map((r, i) => (i === 2 ? { ...r, target: "packages/oauth/oauth-provider/src/index.ts" } : r)),
    rows.map((r, i) => (i === 2 ? { ...r, patch: "../escape.patch" } : r)),
  ]) {
    const changed = new Map(inputs).set(`${prefix}manifest.json`, json({ schema: 1, patches: bad }));
    expect(() => planPatches(files, revision, changed)).toThrow();
  }
  const extra = new Map(inputs).set(`${prefix}hidden`, Buffer.from("extra"));
  expect(() => planPatches(files, revision, extra)).toThrow();
  const missing = new Map(inputs);
  missing.delete(`${prefix}${rows[0]?.patch}`);
  expect(() => planPatches(files, revision, missing)).toThrow();
  const linked = await source();
  const entry = linked.get(`atproto-${revision}/${target}`);
  if (!entry) throw new Error("fixture target");
  entry.header.type = "link";
  expect(() => planPatches(linked, revision, inputs)).toThrow();
  expect(planPatches(files, revision, new Map([[`${prefix}manifest.json`, json({ schema: 1, patches: [] })]]))).toEqual(
    new Map(),
  );
});

test("patch_text_and_hunk_limits_fail_before_unbounded_processing", () => {
  const original = Buffer.from("x\n");
  for (const bytes of [
    Buffer.from([0xff, 10]),
    Buffer.from("\uFEFFx\n"),
    Buffer.from("x\0\n"),
    Buffer.from("x\r\n"),
    Buffer.alloc(1024 * 1024 + 1, 10),
  ])
    expect(() => exactPatch(original, bytes, target)).toThrow();
  expect(() => patchManifest(Buffer.alloc(65537, 10))).toThrow(/size/);
  const hunks = Array.from({ length: 129 }, (_, i) => `@@ -${i + 1},1 +${i + 1},1 @@\n-x\n+y\n`).join("");
  expect(() => exactPatch(Buffer.from("x\n".repeat(129)), patch(target, hunks), target)).toThrow(/hunk/);
  const large = Buffer.from(`first\n${"a".repeat(800000)}\n`);
  expect(() => exactPatch(large, patch(target, `@@ -1,1 +1,2 @@\n first\n+${"b".repeat(300000)}\n`), target)).toThrow(
    /output limit/,
  );
});

test("a_correct_after_hash_cannot_authorize_a_forbidden_target", async () => {
  const files = await source();
  const { inputs, rows } = cohort();
  const row = rows[2];
  if (!row) throw new Error("fixture row");
  const forbidden = "packages/oauth/oauth-provider/src/router/assets/index.ts";
  const entry = files.get(`atproto-${revision}/${row.target}`);
  if (!entry) throw new Error("fixture source");
  files.set(`atproto-${revision}/${forbidden}`, entry);
  const bytes = Buffer.from(
    (inputs.get(`${prefix}${row.patch}`) as Buffer).toString().replaceAll(row.target, forbidden),
  );
  const first = (originals[row.target] as string).split("\n")[0] as string;
  const independentlyExpected = (originals[row.target] as string).replace(`${first}\n`, `${first}\n// fixture 2\n`);
  expect(sha256(independentlyExpected)).toBe(row.outputSha256);
  inputs.set(`${prefix}${row.patch}`, bytes);
  inputs.set(
    `${prefix}manifest.json`,
    json({
      schema: 1,
      patches: rows.map((item, i) => (i === 2 ? { ...item, target: forbidden, patchSha256: sha256(bytes) } : item)),
    }),
  );
  expect(() => planPatches(files, revision, inputs)).toThrow(/target/);
});
