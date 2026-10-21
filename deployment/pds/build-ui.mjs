// ADR0027: build-only input verification, exact source patches and native Vite wiring.
// Node26.10 builtins; pinned Vite8.3.1 node.js:37653+, SWC4.3.3 index.js:178+.
import assert from "node:assert/strict";
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UI = "packages/oauth/oauth-provider-ui";
const PATCHES = "deployment/pds/patches/ui/";
const LIMIT = 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const TARGETS = {
  [`${UI}/src/components/layouts/account-shell.tsx`]:
    "2660a358e58945d9c399bd24a99170bcdff47f0024e0311a432facf8b91245fb",
  [`${UI}/src/components/session-list.tsx`]: "d24f13894ab4cbad910726a7e46ea8f73968785f48fab1e1ead665026e397b2d",
  [`${UI}/src/routes/account/u/$accountId/devices.tsx`]:
    "e08f8848c183779b6c62df7cd4b22d00eebb46ac47273151657975b6b657f8e5",
};
const ROOTS = [
  "apps/pds/src",
  ...["Avatar", "Button", "Icon", "Input", "Mark", "Navigation", "Tag"].map((n) => `shared/ui/components/${n}`),
];
const FILES = [
  "apps/pds/index.ts",
  "apps/pds/package.json",
  "apps/pds/tsconfig.json",
  "shared/ui/package.json",
  "shared/ui/presentation.ts",
  "shared/ui/safe-href.ts",
  "shared/ui/src/class-names.ts",
  ...["layers", "tokens", "base"].map((n) => `shared/ui/src/${n}.css`),
  "shared/ui/icons/icons.json",
  "shared/ui/components/Header/BrandHeader.tsx",
  "shared/ui/components/Header/Header.module.css",
  "shared/ui/components/Link/Link.module.css",
  "scripts/ui/css-scope.ts",
  ...["Dockerfile", "source.lock.json", "build-ui.mjs", "build-inputs.json", "patches/ui/manifest.json"].map(
    (n) => `deployment/pds/${n}`,
  ),
];
const SUPPORT = [
  "did",
  "syntax",
  "oauth/jwk",
  "oauth/oauth-types",
  "oauth/oauth-provider-api",
  "oauth/oauth-scopes",
  "internal/pipe",
  "internal/fetch",
  "internal/rolldown-plugin-bundle-manifest",
].map((n) => `packages/${n}`);
const LOCALES = ["en", "es", "fr", "ja", "ko", "ro", "sv"].map((n) => `${UI}/src/locales/${n}/messages.ts`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) =>
  `${JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v), 2)}\n`;
const inside = (root, path) => path === root || path.startsWith(`${root}/`);
function keys(value, expected) {
  assert(value && typeof value === "object" && !Array.isArray(value), "expected object");
  assert.deepEqual(Object.keys(value).sort(), expected.sort(), "unexpected fields");
}
function text(bytes, limit = LIMIT) {
  assert(bytes.length > 0 && bytes.length <= limit && isUtf8(bytes), "text size/UTF8");
  const value = bytes.toString();
  assert(value.endsWith("\n") && !/[\r\0\uFEFF]/u.test(value), "expected LF without BOM/NUL");
  return value;
}
function json(bytes) {
  const value = text(bytes, 65536),
    parsed = JSON.parse(value);
  assert.equal(canonical(parsed), value, "noncanonical/duplicate JSON");
  return parsed;
}
function regular(root, path) {
  const parts = path.split("/");
  assert(
    parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) && p !== ".."),
    "input path",
  );
  for (let i = 1; i < parts.length; i++)
    assert(lstatSync(join(root, ...parts.slice(0, i))).isDirectory(), "input ancestor");
  const stat = lstatSync(join(root, path));
  assert(stat.isFile() && stat.nlink === 1 && stat.size <= LIMIT, "bounded regular input");
  return readFileSync(join(root, path));
}
function manifest(raw) {
  const value = json(raw);
  keys(value, ["schema", "patches"]);
  assert(value.schema === 1 && Array.isArray(value.patches), "patch schema");
  assert(value.patches.length === 0 || value.patches.length === 3, "complete Devices cohort required");
  let previous = "";
  const names = new Set();
  for (const row of value.patches) {
    keys(row, ["inputSha256", "outputSha256", "patch", "patchSha256", "target"]);
    assert(
      typeof row.target === "string" && Object.hasOwn(TARGETS, row.target) && row.target > previous,
      "patch target/order",
    );
    assert(
      typeof row.patch === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*\.patch$/.test(row.patch) && !names.has(row.patch),
      "patch name",
    );
    assert(
      [row.inputSha256, row.outputSha256, row.patchSha256].every((h) => typeof h === "string" && HASH.test(h)),
      "patch hashes",
    );
    assert(row.inputSha256 === TARGETS[row.target] && row.outputSha256 !== row.inputSha256, "patch input pin/output");
    previous = row.target;
    names.add(row.patch);
  }
  return value.patches;
}
function packages(files) {
  for (const [path, name, exports, dependencies, devDependencies] of [
    [
      "apps/pds/package.json",
      "@unset/apps-pds",
      { ".": "./index.ts" },
      { "@unset/shared-ui": "*", react: "19.3.0" },
      { "@types/react": "19.3.0" },
    ],
    [
      "shared/ui/package.json",
      "@unset/shared-ui",
      {
        ".": "./index.ts",
        "./presentation": "./presentation.ts",
        "./brand-header": "./components/Header/BrandHeader.tsx",
      },
      { "@unset/shared-islands": "*", react: "19.3.0" },
      { "@types/react": "19.3.0", "@types/react-dom": "19.3.0", "react-dom": "19.3.0" },
    ],
  ]) {
    const pkg = JSON.parse(files.get(path));
    assert(
      Object.keys(pkg).every((k) =>
        ["name", "version", "private", "type", "license", "exports", "dependencies", "devDependencies"].includes(k),
      ),
      "package metadata",
    );
    assert(pkg.name === name && pkg.type === "module" && pkg.private === true, "package identity");
    assert.equal(canonical(pkg.exports), canonical(exports), "package exports");
    assert.equal(canonical(pkg.dependencies ?? {}), canonical(dependencies), "package dependencies");
    assert.equal(canonical(pkg.devDependencies ?? {}), canonical(devDependencies), "package devDependencies");
  }
}
function rootInput(path) {
  return ROOTS.some((r) => inside(r, path)) && /\.(?:tsx?|css)$/.test(path) && !/\.test\.tsx?$/.test(path);
}
function inputDirectory(path, name, required) {
  const withinRoot = ROOTS.some((r) => inside(r, path));
  assert([...required, ...ROOTS].some((p) => inside(path, p)) || withinRoot, "extra input directory");
  assert(!withinRoot || !name.includes("."), "input root directory");
}
function observeInputs(root, digest) {
  assert(HASH.test(digest), "input digest syntax");
  const rows = manifest(regular(root, `${PATCHES}manifest.json`));
  const required = new Set([...FILES, ...rows.map((r) => `${PATCHES}${r.patch}`)]);
  const files = new Map();
  let entries = 0,
    total = 0,
    rootEntries = 0;
  const directories = [];
  function checkRootEntry(path, directory) {
    for (const root of ROOTS) {
      if (path === root || !inside(root, path)) continue;
      const depth = path.slice(root.length + 1).split("/").length;
      assert(++rootEntries <= 1024 && depth <= (directory ? 16 : 17), "selected root bounds");
    }
  }
  function visit(path, depth) {
    assert(depth <= 20 && lstatSync(join(root, path)).isDirectory(), "input directory/depth");
    for (const name of readdirSync(join(root, path))) {
      assert(++entries <= 1100 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), "input entry/name limit");
      const child = path ? `${path}/${name}` : name;
      const directory = lstatSync(join(root, child)).isDirectory();
      checkRootEntry(child, directory);
      if (directory) {
        inputDirectory(child, name, required);
        directories.push(child);
        visit(child, depth + 1);
      } else {
        assert(required.has(child) || rootInput(child), "unregistered input");
        const bytes = regular(root, child);
        total += bytes.length;
        assert(total <= 8 * LIMIT && files.size < 512, "input size/count");
        files.set(child, bytes);
      }
    }
  }
  visit("", 0);
  for (const path of required) assert(files.has(path), "missing input");
  for (const path of directories)
    assert(
      [...files.keys()].some((p) => p.startsWith(`${path}/`)),
      "extra empty input directory",
    );
  for (const path of ROOTS) assert(lstatSync(join(root, path)).isDirectory(), "missing input root");
  assert(new Set([...files.keys()].map((p) => p.toLowerCase())).size === files.size, "input case collision");
  assert.equal(
    files.get("deployment/pds/build-inputs.json").toString(),
    canonical({ schema: 1, selection: "pds-presentation-v1" }),
    "input policy",
  );
  const inventory = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, b]) => [p, hash(b)]);
  assert.equal(hash(canonical(inventory)), digest, "observed input digest mismatch");
  packages(files);
  return { files, rows };
}
function hunk(source, lines, start, initial, count, nextCount) {
  let line = start,
    cursor = initial,
    consumed = 0,
    produced = 0,
    changed = false;
  const output = [];
  while (line < lines.length && !lines[line].startsWith("@@")) {
    const body = lines[line++],
      control = body[0],
      content = body.slice(1);
    assert(control === " " || control === "-" || control === "+", "hunk body");
    if (control !== "+") {
      assert.equal(source[cursor], content, "hunk context");
      assert(++consumed <= count, "hunk input count");
      cursor++;
    }
    if (control !== "-") {
      assert(++produced <= nextCount, "hunk output count");
      output.push(content);
    }
    changed ||= control !== " ";
  }
  assert(consumed === count && produced === nextCount, "truncated hunk");
  return { line, cursor, output, changed };
}
function patch(original, bytes, target) {
  const source = text(original).slice(0, -1).split("\n");
  const lines = text(bytes).slice(0, -1).split("\n");
  assert(lines[0] === `--- a/${target}` && lines[1] === `+++ b/${target}`, "patch headers");
  const output = [];
  let line = 2,
    cursor = 0,
    hunks = 0,
    changed = false;
  while (line < lines.length) {
    const header = /^@@ -([1-9][0-9]*),([1-9][0-9]*) \+([1-9][0-9]*),([1-9][0-9]*) @@$/.exec(lines[line++]);
    assert(header && ++hunks <= 128, "hunk header/count");
    const [old, count, next, nextCount] = header.slice(1).map(Number);
    assert(
      [old, count, next, nextCount].every(Number.isSafeInteger) &&
        old - 1 >= cursor &&
        old - 1 + count <= source.length,
      "hunk range",
    );
    for (const value of source.slice(cursor, old - 1)) output.push(value);
    cursor = old - 1;
    assert.equal(next - 1, output.length, "hunk output coordinate");
    const body = hunk(source, lines, line, cursor, count, nextCount);
    line = body.line;
    cursor = body.cursor;
    for (const value of body.output) output.push(value);
    changed ||= body.changed;
  }
  assert(hunks > 0 && changed, "empty patch");
  for (const value of source.slice(cursor)) output.push(value);
  const result = Buffer.from(`${output.join("\n")}\n`);
  assert(result.length <= LIMIT && !result.equals(original), "output limit/unchanged");
  return result;
}
function sourceIdentity(root, path, stat, dependencies) {
  if (stat.isDirectory()) return ["directory", stat.mode];
  const absolute = join(root, path),
    dependency = dependencies.some((p) => inside(p, path));
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(absolute);
    assert(inside(root, resolve(dirname(absolute), target)), "source link escapes");
    if (dependency) assert(inside(root, realpathSync(absolute)), "dependency link escapes");
    return ["link", stat.mode, target];
  }
  assert(stat.isFile() && (dependency || stat.nlink === 1), "source special/hardlink");
  return ["file", stat.mode, dependency ? null : hash(readFileSync(absolute))];
}
function snapshot(root, dependencies = []) {
  const result = Object.create(null);
  let count = 0,
    bytes = 0;
  function visit(path) {
    for (const name of readdirSync(join(root, path))) {
      assert(!/[\0\r\n\\]/u.test(name), "source name");
      const child = path ? `${path}/${name}` : name,
        absolute = join(root, child),
        stat = lstatSync(absolute);
      bytes += stat.size;
      assert(++count <= 200000 && bytes <= 3 * 1024 ** 3, "source/install bounds");
      const identity = sourceIdentity(root, child, stat, dependencies);
      result[child] = identity;
      if (stat.isDirectory()) visit(child);
    }
  }
  visit("");
  return result;
}
function generated(path, type, original, dependencies) {
  if (dependencies.some((p) => inside(p, path))) return true;
  const roots = SUPPORT.map((p) => `${p}/dist`);
  if (inside(`${UI}/dist`, path)) {
    if (type === "directory") return path === `${UI}/dist`;
    return (
      type === "file" &&
      dirname(path) === `${UI}/dist` &&
      (path === `${UI}/dist/bundle-manifest.json` ||
        /^[A-Za-z0-9_-]+\.(?:js|css|js\.map)$/.test(path.slice(`${UI}/dist/`.length)))
    );
  }
  const exact = [...LOCALES, ...SUPPORT.map((p) => `${p}/tsconfig.build.tsbuildinfo`)];
  if (type === "directory") {
    if ([...roots, ...exact].some((p) => inside(path, p))) return true;
    return SUPPORT.some(
      (p) => inside(`${p}/dist`, path) && original[path.replace(`${p}/dist/`, `${p}/src/`)]?.[0] === "directory",
    );
  }
  if (type !== "file") return false;
  if (exact.includes(path)) return true;
  return SUPPORT.some((p) => {
    if (!inside(`${p}/dist`, path)) return false;
    const stem = path.slice(`${p}/dist/`.length).replace(/(?:\.d)?\.js(?:\.map)?$|\.d\.ts(?:\.map)?$/, "");
    return (
      /\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(path) &&
      Boolean(original[`${p}/src/${stem}.ts`] || original[`${p}/src/${stem}.tsx`])
    );
  });
}
function verifySource(source, state, installed) {
  const dependencies = installed ? state.dependencies : [];
  const actual = snapshot(source, dependencies);
  for (const [path, identity] of Object.entries(state.expected))
    assert.deepEqual(actual[path], identity, `original drift: ${path}`);
  for (const [path, identity] of Object.entries(actual)) {
    if (!Object.hasOwn(state.original, path))
      assert(installed && generated(path, identity[0], state.original, dependencies), `undeclared source: ${path}`);
  }
}
function prepare(inputs, source, statePath) {
  const original = snapshot(source),
    plans = new Map();
  for (const row of inputs.rows) {
    const entry = original[row.target],
      bytes = inputs.files.get(`${PATCHES}${row.patch}`);
    assert(
      entry?.[0] === "file" && entry[2] === row.inputSha256 && hash(bytes) === row.patchSha256,
      "patch input/type/hash",
    );
    const result = patch(readFileSync(join(source, row.target)), bytes, row.target);
    assert.equal(hash(result), row.outputSha256, "patch output hash");
    plans.set(row.target, result);
  }
  const dependencies = Object.keys(original)
    .filter((p) => p === "package.json" || p.endsWith("/package.json"))
    .map((p) => (p === "package.json" ? "node_modules" : `${dirname(p)}/node_modules`));
  const expected = structuredClone(original);
  // All plans are validated against original bytes before the first source write.
  for (const [path, bytes] of plans) {
    writeFileSync(join(source, path), bytes);
    expected[path][2] = hash(bytes);
  }
  const state = { original, expected, dependencies };
  verifySource(source, state, false);
  writeFileSync(statePath, canonical(state), { flag: "wx" });
}
function configuration(inputs, source, destination, selection) {
  const selected = [...selection];
  const ui = join(source, UI),
    req = createRequire(join(ui, "package.json"));
  const runtime = Object.fromEntries(
    ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"].map((id) => [
      id,
      realpathSync(req.resolve(id)),
    ]),
  );
  const runtimeRoots = ["react", "react-dom"].map((id) => dirname(realpathSync(req.resolve(`${id}/package.json`))));
  for (const root of runtimeRoots)
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, "19.3.0", "runtime pin");
  assert.equal(JSON.parse(readFileSync(req.resolve("vite/package.json"))).version, "8.3.1", "Vite pin");
  const tokens = join(inputs, "shared/ui/src/tokens.css");
  let fonts = regular(inputs, "shared/ui/src/tokens.css").toString();
  for (const name of ["SpaceGrotesk-Variable", "JetBrainsMono-Variable"]) {
    const old = `../fonts/${name}.woff2`;
    assert.equal(fonts.split(old).length, 2, "exact font occurrence");
    fonts = fonts.replace(old, `/_unset/fonts/${name}.woff2`);
  }
  // Vite8.3.1 routes explicit tsconfig to both OXC and native resolution
  // (node.js:7606,28924,34326). Use the existing upstream UI config for local TS too.
  const url = (path) => JSON.stringify(pathToFileURL(path).href);
  // Supplemental config only. Original config, source, lock and plugin instances stay intact.
  const config = `import upstream from ${url(join(ui, "vite.config.js"))};
import { scopedName } from ${url(join(inputs, "scripts/ui/css-scope.ts"))};
import { realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
const local = ${JSON.stringify(inputs)};
const runtime = ${JSON.stringify(runtime)};
const roots = ${JSON.stringify(runtimeRoots)};
const app = local + '/apps/pds/index.ts';
const selected = new Set(${JSON.stringify([...selected])}.map(p => local + '/' + p));
const graph = { react: [], reactDom: [], local: [] };
const wiring = {
  name: 'unset-pds-presentation', enforce: 'pre',
  resolveId(id) { if (Object.hasOwn(runtime, id)) return runtime[id]; },
  load(id) { if (id === ${JSON.stringify(tokens)}) return ${JSON.stringify(fonts)}; },
  transform(code, id) {
    if (id === app) return { code: ${JSON.stringify(`${["layers", "tokens", "base"].map((n) => `import ${JSON.stringify(join(inputs, `shared/ui/src/${n}.css`))};`).join("\n")}\n`)} + code, map: null };
  },
  generateBundle() {
    for (const raw of this.getModuleIds()) {
      const id = raw.replace(/^\\0/, '').split('?')[0];
      if (!isAbsolute(id)) continue;
      if (id.startsWith(local + '/')) {
        const presentation = id.startsWith(local + '/apps/pds/') || id.startsWith(local + '/shared/ui/');
        if (!selected.has(id) || !presentation) throw new Error('unselected presentation module: ' + id);
        graph.local.push(raw);
      }
      if (/(?:^|\\/)node_modules\\/react(?:-dom)?\\//.test(id)) {
        const real = realpathSync(id);
        const index = roots.findIndex(root => real.startsWith(root + '/'));
        if (index < 0) throw new Error('foreign React graph: ' + id);
        graph[index === 0 ? 'react' : 'reactDom'].push(raw);
      }
    }
    if (!graph.react.length || !graph.reactDom.length) throw new Error('missing React graph');
    writeFileSync(${JSON.stringify(join(dirname(destination), "graph.json"))}, JSON.stringify({ versions: ['19.3.0', '19.3.0'], roots, ...graph }, null, 2));
  }
};
export default {
  ...upstream,
  tsconfig: ${JSON.stringify(join(ui, "tsconfig.json"))},
  cacheDir: ${JSON.stringify(join(dirname(destination), "cache"))},
  resolve: { ...upstream.resolve, preserveSymlinks: false, dedupe: ['react', 'react-dom'], alias: [
    { find: /^@unset\\/apps-pds$/, replacement: app },
    { find: /^@unset\\/shared-ui\\/presentation$/, replacement: local + '/shared/ui/presentation.ts' },
    { find: /^@unset\\/shared-ui\\/brand-header$/, replacement: local + '/shared/ui/components/Header/BrandHeader.tsx' },
    ...Object.entries(upstream.resolve.alias).map(([find, replacement]) => ({ find, replacement }))
  ] },
  css: { ...upstream.css, modules: { ...upstream.css?.modules, generateScopedName: scopedName } },
  plugins: [...upstream.plugins, wiring]
};
`;
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, config, { flag: "wx" });
}
function main() {
  const [separator, command, inputPath, digest, sourcePath, statePath, configPath, ...extra] = process.argv.slice(2);
  assert(
    separator === "--" && ["prepare", "configure", "verify"].includes(command) && extra.length === 0,
    "usage: build-ui.mjs -- prepare|configure|verify INPUTS DIGEST SOURCE STATE [CONFIG]",
  );
  assert(
    [inputPath, sourcePath, statePath].every((p) => typeof p === "string" && isAbsolute(p)),
    "absolute builder paths required",
  );
  const inputs = realpathSync(inputPath),
    source = realpathSync(sourcePath),
    state = resolve(statePath);
  assert(
    !inside(source, inputs) && !inside(inputs, source) && !inside(source, state) && !inside(inputs, state),
    "separate builder trees required",
  );
  const observed = observeInputs(inputs, digest);
  if (command === "prepare") {
    assert(!configPath, "unexpected config");
    prepare(observed, source, state);
  } else {
    verifySource(source, JSON.parse(readFileSync(state)), true);
    if (command === "configure") {
      assert(
        configPath &&
          isAbsolute(configPath) &&
          !inside(source, resolve(configPath)) &&
          !inside(inputs, resolve(configPath)),
        "external config required",
      );
      configuration(inputs, source, resolve(configPath), observed.files.keys());
    } else assert(!configPath, "unexpected config");
  }
}
try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "builder failed"}\n`);
  process.exitCode = 1;
}
