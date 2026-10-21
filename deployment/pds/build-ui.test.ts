import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

const repo = join(import.meta.dirname, "../..");
const { roots, files }: { roots: string[]; files: string[] } = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/local-inputs.json"), "utf8"),
);
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const json = (value: unknown): string =>
  `${JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v), 2)}\n`;
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function put(root: string, path: string, data: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), data);
}
function tree(root: string, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(join(root, path));
    result[path] = [
      stat.mode,
      stat.isSymbolicLink()
        ? readlinkSync(join(root, path))
        : stat.isFile()
          ? hash(readFileSync(join(root, path)))
          : "directory",
    ];
    if (stat.isDirectory()) Object.assign(result, tree(root, path));
  }
  return result;
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pds-builder-"));
  temporary.push(root);
  const inputs = join(root, "inputs"),
    source = join(root, "source"),
    state = join(root, "state.json");
  const selected = new Set(files);
  const select = (path: string) => {
    for (const name of readdirSync(join(repo, path))) {
      const child = `${path}/${name}`;
      if (lstatSync(join(repo, child)).isDirectory()) select(child);
      else if (/\.(?:tsx?|css)$/.test(child) && !/\.test\.tsx?$/.test(child)) selected.add(child);
    }
  };
  for (const path of roots) select(path);
  for (const path of selected) put(inputs, path, readFileSync(join(repo, path)));
  const originals: Record<string, string> = JSON.parse(
    readFileSync(join(repo, "scripts/ci/pds-ui/fixtures/patch-targets.json"), "utf8"),
  );
  for (const [path, data] of Object.entries(originals)) put(source, path, data);
  put(source, "packages/did/src/index.ts", "export {};\n");
  put(source, "package.json", "{}\n");
  put(source, "pnpm-lock.yaml", "locked\n");
  put(source, "packages/oauth/oauth-provider-ui/package.json", "{}\n");
  put(source, "packages/oauth/oauth-provider-ui/hydration-data.d.ts", "original declaration\n");
  symlinkSync("../hydration-data.d.ts", join(source, "packages/oauth/oauth-provider-ui/src/hydration-data.d.ts"));
  const digest = () => hash(json([...selected].sort().map((path) => [path, hash(readFileSync(join(inputs, path)))])));
  const run = (command = "prepare", expected = digest(), extra: string[] = []) =>
    spawnSync(
      process.execPath,
      [join(inputs, "deployment/pds/build-ui.mjs"), "--", command, inputs, expected, source, state, ...extra],
      { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, NODE_OPTIONS: "" } },
    );
  const cohort = () => {
    const rows = Object.keys(originals)
      .sort()
      .map((target, i) => {
        const original = originals[target] as string;
        const patch = `${i === 0 ? "account-shell" : i === 1 ? "session-list" : "devices"}.patch`;
        const bytes = `--- a/${target}\n+++ b/${target}\n@@ -1,1 +1,2 @@\n+// présentation\n ${original.split("\n")[0]}\n`;
        put(inputs, `deployment/pds/patches/ui/${patch}`, bytes);
        selected.add(`deployment/pds/patches/ui/${patch}`);
        return {
          inputSha256: hash(original),
          outputSha256: hash(`// présentation\n${original}`),
          patch,
          patchSha256: hash(bytes),
          target,
        };
      });
    put(inputs, "deployment/pds/patches/ui/manifest.json", json({ patches: rows, schema: 1 }));
    return rows;
  };
  return { root, inputs, source, state, selected, originals, digest, run, cohort };
}

test.each(["digest", "extra", "empty-dir", "missing", "symlink", "hardlink", "fifo", "dependency"])(
  "input_boundary_rejects_%s_without_source_writes",
  (kind) => {
    const f = fixture(),
      digest = f.digest(),
      before = tree(f.source);
    if (kind === "extra") put(f.inputs, "extra.ts", "extra\n");
    if (kind === "empty-dir") mkdirSync(join(f.inputs, "apps/pds/src/empty"));
    if (kind === "missing") rmSync(join(f.inputs, "apps/pds/index.ts"));
    if (kind === "symlink") {
      rmSync(join(f.inputs, "apps/pds/index.ts"));
      symlinkSync("package.json", join(f.inputs, "apps/pds/index.ts"));
    }
    if (kind === "hardlink") {
      const p = join(f.inputs, "apps/pds/index.ts");
      linkSync(p, join(f.root, "input-hardlink"));
    }
    if (kind === "fifo") {
      rmSync(join(f.inputs, "apps/pds/index.ts"));
      execFileSync("mkfifo", [join(f.inputs, "apps/pds/index.ts")]);
    }
    if (kind === "dependency") {
      const p = "apps/pds/package.json",
        pkg = JSON.parse(readFileSync(join(f.inputs, p), "utf8"));
      pkg.dependencies.react = "99.0.0";
      put(f.inputs, p, JSON.stringify(pkg));
    }
    expect(
      f.run("prepare", kind === "digest" ? "0".repeat(64) : kind === "dependency" ? f.digest() : digest).status,
    ).not.toBe(0);
    expect(tree(f.source)).toEqual(before);
  },
);
test("complete_cohort_applies_exact_declared_outputs_and_reapplication_fails", () => {
  const f = fixture(),
    rows = f.cohort();
  expect(f.run().status).toBe(0);
  for (const row of rows)
    expect(readFileSync(join(f.source, row.target), "utf8")).toBe(`// présentation\n${f.originals[row.target]}`);
  expect(f.run("verify").status).toBe(0);
  expect(f.run().status).not.toBe(0);
});
test("late_bad_patch_row_leaves_every_original_target_unchanged", () => {
  const f = fixture(),
    rows = f.cohort(),
    before = tree(f.source);
  const row = rows[2];
  if (!row) throw new Error("fixture");
  row.outputSha256 = "0".repeat(64);
  put(f.inputs, "deployment/pds/patches/ui/manifest.json", json({ patches: rows, schema: 1 }));
  expect(f.run().status).not.toBe(0);
  expect(tree(f.source)).toEqual(before);
});
test.each([
  "file",
  "remove",
  "mode",
  "link",
  "new-source",
  "generated-source",
  "dist-source",
  "dependency-link",
  "generated-directory",
  "special",
  "generated-link",
])("whole_original_tree_rejects_%s_drift", (kind) => {
  const f = fixture();
  expect(f.run().status).toBe(0);
  if (kind === "file") put(f.source, "pnpm-lock.yaml", "changed\n");
  if (kind === "remove") rmSync(join(f.source, "pnpm-lock.yaml"));
  if (kind === "mode") chmodSync(join(f.source, "pnpm-lock.yaml"), 0o755);
  if (kind === "link") {
    rmSync(join(f.source, "packages/oauth/oauth-provider-ui/src/hydration-data.d.ts"));
    symlinkSync("../../package.json", join(f.source, "packages/oauth/oauth-provider-ui/src/hydration-data.d.ts"));
  }
  if (kind === "new-source") put(f.source, "packages/oauth/oauth-provider-ui/src/evil.ts", "extra\n");
  if (kind === "generated-source") put(f.source, "packages/oauth/oauth-provider-ui/src/routeTree.gen.ts", "extra\n");
  if (kind === "dist-source") put(f.source, "packages/did/dist/evil.ts", "extra\n");
  if (kind === "dependency-link") {
    mkdirSync(join(f.source, "node_modules"));
    symlinkSync("/tmp", join(f.source, "node_modules/escape"));
  }
  if (kind === "generated-directory")
    mkdirSync(join(f.source, "packages/oauth/oauth-provider-ui/dist/extra"), { recursive: true });
  if (kind === "special") execFileSync("mkfifo", [join(f.source, "source-pipe")]);
  if (kind === "generated-link") {
    mkdirSync(join(f.source, "packages/oauth/oauth-provider-ui/src/locales/en"), { recursive: true });
    symlinkSync(
      "../../hydration-data.d.ts",
      join(f.source, "packages/oauth/oauth-provider-ui/src/locales/en/messages.ts"),
    );
  }
  expect(f.run("verify").status).not.toBe(0);
});
test("empty_bootstrap_preserves_originals_and_accepts_only_compiler_outputs", () => {
  const f = fixture(),
    before = tree(f.source);
  expect(f.run().status).toBe(0);
  expect(tree(f.source)).toEqual(before);
  put(f.source, "packages/oauth/oauth-provider-ui/src/locales/en/messages.ts", "export const messages = {};\n");
  put(f.source, "packages/did/dist/index.js", "export {};\n");
  put(f.source, "packages/did/tsconfig.build.tsbuildinfo", "{}\n");
  put(f.source, "packages/oauth/oauth-provider-ui/dist/account-page-ab.js", "// native output\n");
  put(f.source, "node_modules/.pnpm/pkg/index.js", "module.exports = {};\n");
  symlinkSync(".pnpm/pkg", join(f.source, "node_modules/pkg"));
  expect(f.run("verify").status).toBe(0);
});

test("snapshot_keeps_original_identity_separate_from_declared_patch_outputs", () => {
  const f = fixture(),
    rows = f.cohort();
  expect(f.run().status).toBe(0);
  const state = JSON.parse(readFileSync(f.state, "utf8"));
  for (const row of rows) {
    expect(state.original[row.target][2]).toBe(row.inputSha256);
    expect(state.expected[row.target][2]).toBe(row.outputSha256);
  }
});
function patchEncoding(kind: string, bytes: Buffer) {
  if (kind === "crlf") return Buffer.from(bytes.toString().replaceAll("\n", "\r\n"));
  if (kind === "bom") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
  if (kind === "invalid-utf8") return Buffer.concat([bytes, Buffer.from([0xff, 10])]);
  return bytes;
}
test.each([
  "wrong-offset",
  "new-coordinate",
  "old-count",
  "new-count",
  "leading-zero",
  "metadata",
  "truncated",
  "crlf",
  "bom",
  "invalid-utf8",
  "overlap",
  "unknown-target",
  "partial-cohort",
  "duplicate-key",
  "extra-patch",
])("exact_patch_dialect_rejects_%s_with_zero_writes", (kind) => {
  const f = fixture(),
    rows = f.cohort(),
    row = rows[0];
  if (!row) throw new Error("fixture");
  const path = `${"deployment/pds/patches/ui/"}${row.patch}`;
  let bytes: Buffer = readFileSync(join(f.inputs, path));
  if (kind === "wrong-offset") {
    bytes = Buffer.from(`--- a/${row.target}\n+++ b/${row.target}\n@@ -1,1 +1,2 @@\n+// wrong offset\n \n`);
    row.outputSha256 = hash(
      `// wrong offset\n\n${(f.originals[row.target] as string).split("\n").slice(1).join("\n")}`,
    );
  }
  if (kind === "new-coordinate") bytes = Buffer.from(bytes.toString().replace("+1,2", "+2,2"));
  if (kind === "old-count") bytes = Buffer.from(bytes.toString().replace("-1,1", "-1,2"));
  if (kind === "new-count") bytes = Buffer.from(bytes.toString().replace("+1,2", "+1,1"));
  if (kind === "leading-zero") bytes = Buffer.from(bytes.toString().replace("-1,1", "-01,1"));
  if (kind === "metadata") bytes = Buffer.from(`diff --git a/source b/source\n${bytes}`);
  if (kind === "truncated") bytes = Buffer.from(`${bytes.toString().split("\n").slice(0, -2).join("\n")}\n`);
  bytes = patchEncoding(kind, bytes);
  if (kind === "overlap") bytes = Buffer.concat([bytes, Buffer.from(bytes.toString().split("\n").slice(2).join("\n"))]);
  if (kind === "unknown-target") row.target = "packages/pds/src/index.ts";
  row.patchSha256 = hash(bytes);
  put(f.inputs, path, bytes);
  const manifestPath = "deployment/pds/patches/ui/manifest.json";
  let raw = json({ patches: kind === "partial-cohort" ? rows.slice(0, 1) : rows, schema: 1 });
  if (kind === "duplicate-key") raw = raw.replace('"schema": 1', '"schema": 1, "schema": 1');
  put(f.inputs, manifestPath, raw);
  if (kind === "extra-patch") {
    put(f.inputs, "deployment/pds/patches/ui/extra.patch", bytes);
    f.selected.add("deployment/pds/patches/ui/extra.patch");
  }
  const before = tree(f.source);
  expect(f.run().status).not.toBe(0);
  expect(tree(f.source)).toEqual(before);
});
test("two_exact_hunks_preserve_unicode_line_changes_and_untouched_suffix", () => {
  const f = fixture(),
    rows = f.cohort(),
    row = rows[0];
  if (!row) throw new Error("fixture");
  const lines = (f.originals[row.target] as string).split("\n");
  const bytes = `--- a/${row.target}\n+++ b/${row.target}\n@@ -1,1 +1,2 @@\n+// première\n ${lines[0]}\n@@ -3,1 +4,1 @@\n-${lines[2]}\n+// deuxième\n`;
  const expected = [`// première`, lines[0], lines[1], "// deuxième", ...lines.slice(3)].join("\n");
  row.patchSha256 = hash(bytes);
  row.outputSha256 = hash(expected);
  put(f.inputs, `deployment/pds/patches/ui/${row.patch}`, bytes);
  put(f.inputs, "deployment/pds/patches/ui/manifest.json", json({ patches: rows, schema: 1 }));
  const result = f.run();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(readFileSync(join(f.source, row.target), "utf8")).toBe(expected);
});
