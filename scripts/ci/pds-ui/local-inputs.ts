// ADR0027: a fixed selected context, never a checkout COPY or builder-claimed inventory.
// Node26.10 fs/child_process APIs: @types/node26.6.5 fs.d.ts, child_process.d.ts.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireThat, sha256 } from "./archive.ts";
import { canonical, PATCH_DIRECTORY, patchManifest } from "./source-patches.ts";

export const INPUT_ROOTS = [
  "apps/pds/src",
  ...["Avatar", "Button", "Icon", "Input", "Mark", "Navigation", "Tag"].map((name) => `shared/ui/components/${name}`),
];
export const INPUT_FILES = [
  "apps/pds/index.ts",
  "apps/pds/package.json",
  "apps/pds/tsconfig.json",
  "shared/ui/package.json",
  "shared/ui/presentation.ts",
  "shared/ui/safe-href.ts",
  "shared/ui/src/class-names.ts",
  ...["layers", "tokens", "base"].map((name) => `shared/ui/src/${name}.css`),
  "shared/ui/icons/icons.json",
  "shared/ui/components/Header/BrandHeader.tsx",
  "shared/ui/components/Header/Header.module.css",
  "shared/ui/components/Link/Link.module.css",
  "scripts/ui/css-scope.ts",
  "deployment/pds/Dockerfile",
  "deployment/pds/source.lock.json",
  "deployment/pds/build-ui.mjs",
  "deployment/pds/build-inputs.json",
  `${PATCH_DIRECTORY}manifest.json`,
];
const POLICY = canonical({ schema: 1, selection: "pds-presentation-v1" });
const STOCK = "7077f215d20a2c5da1a03980e519b0c09dd57ee7c7593f24b2363eb97ec6f851";
export const excluded = (path: string) =>
  /\.test\.tsx?$/.test(path) || path === "shared/ui/components/Navigation/README.md";
export function regular(root: string, path: string): Buffer {
  const parts = path.split("/");
  requireThat(
    parts.every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== ".."),
    "noncanonical input path",
  );
  for (let i = 1; i < parts.length; i++)
    requireThat(lstatSync(join(root, ...parts.slice(0, i))).isDirectory(), "input ancestor must be directory");
  const stat = lstatSync(join(root, path));
  requireThat(
    stat.isFile() && stat.nlink === 1 && stat.size <= 1024 * 1024,
    "input must be bounded regular unlinked file",
  );
  return readFileSync(join(root, path));
}
function dependencyFields(pkg: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "bundledDependencies",
    "bundleDependencies",
  ])
    requireThat(
      canonical(pkg[field] ?? {}) === canonical(expected[field] ?? {}),
      "unexpected local dependency/runtime declaration",
    );
}
function packages(files: Map<string, Buffer>): void {
  const pkg = (path: string): Record<string, unknown> => JSON.parse(files.get(path)?.toString() ?? "");
  const shape = (value: Record<string, unknown>) => {
    const fields = ["name", "version", "private", "type", "license", "exports", "dependencies", "devDependencies"];
    requireThat(
      Object.keys(value).every((key) => fields.includes(key)) && value.type === "module" && value.private === true,
      "unexpected package alias/runtime metadata",
    );
  };
  const app = pkg("apps/pds/package.json");
  shape(app);
  requireThat(
    app.name === "@unset/apps-pds" &&
      canonical(app.exports) === canonical({ ".": "./index.ts" }) &&
      !app.bin &&
      !app.main &&
      !app.scripts,
    "invalid presentation package entry/role",
  );
  dependencyFields(app, {
    dependencies: { "@unset/shared-ui": "*", react: "19.3.0" },
    devDependencies: { "@types/react": "19.3.0" },
  });
  const shared = pkg("shared/ui/package.json");
  shape(shared);
  requireThat(
    shared.name === "@unset/shared-ui" &&
      canonical(shared.exports) ===
        canonical({
          ".": "./index.ts",
          "./presentation": "./presentation.ts",
          "./brand-header": "./components/Header/BrandHeader.tsx",
        }),
    "shared public entry drift",
  );
  dependencyFields(shared, {
    dependencies: { "@unset/shared-islands": "*", react: "19.3.0" },
    devDependencies: { "@types/react": "19.3.0", "@types/react-dom": "19.3.0", "react-dom": "19.3.0" },
  });
}
export function inventoryHash(files: Map<string, Buffer>): string {
  return sha256(
    canonical(
      [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, bytes]) => [path, sha256(bytes)]),
    ),
  );
}
function localRecipe(recipe: Buffer): void {
  const lines = recipe
    .toString()
    .split("\n")
    .map((line) => line.trim());
  requireThat(sha256(recipe) !== STOCK && lines.includes("ARG UNSET_INPUTS_SHA256"), "unregistered local recipe");
  for (const line of lines.filter((text) => /^COPY\b/i.test(text))) {
    const parts = line.split(/\s+/);
    if (parts[1]?.startsWith("--from="))
      requireThat(
        ["--from=ui-build", "--from=ui-artifact"].includes(parts.splice(1, 1)[0] as string),
        "unregistered copy stage",
      );
    const source = parts[1] ?? "";
    requireThat(
      parts.length === 3 &&
        /^[A-Za-z0-9/][A-Za-z0-9/._-]*$/.test(source) &&
        ![".", "./", "/"].includes(source) &&
        !source.split("/").includes(".."),
      "unregistered copy source/dialect",
    );
  }
}
export function localInputs(root: string) {
  const files = new Map<string, Buffer>();
  const recipe = regular(root, "deployment/pds/Dockerfile");
  const lock = regular(root, "deployment/pds/source.lock.json");
  files.set("deployment/pds/Dockerfile", recipe);
  files.set("deployment/pds/source.lock.json", lock);
  const sourceLockSha256 = sha256(lock);
  if (!lstatSync(join(root, "deployment/pds/build-inputs.json"), { throwIfNoEntry: false })) {
    requireThat(
      sha256(recipe) === STOCK &&
        !lstatSync(join(root, "deployment/pds/build-ui.mjs"), { throwIfNoEntry: false }) &&
        !lstatSync(join(root, PATCH_DIRECTORY), { throwIfNoEntry: false }),
      "unregistered stock recipe or local-policy downgrade",
    );
    return {
      mode: "stock" as const,
      files,
      sourceLockSha256,
      inventorySha256: null,
      patchManifestSha256: null,
      policySha256: null,
    };
  }
  let total = recipe.length + lock.length;
  const add = (path: string): void => {
    const data = regular(root, path);
    total += data.length;
    requireThat(total <= 8 * 1024 * 1024 && files.size < 512, "input byte/count limit");
    files.set(path, data);
  };
  for (const path of INPUT_FILES) if (!files.has(path)) add(path);
  requireThat(
    files.get("deployment/pds/build-inputs.json")?.toString() === POLICY,
    "unregistered local selection policy",
  );
  localRecipe(recipe);
  let entries = 0;
  const visit = (path: string, depth: number): void => {
    requireThat(depth <= 16 && lstatSync(join(root, path)).isDirectory(), "input directory/depth");
    for (const name of readdirSync(join(root, path))) {
      requireThat(++entries <= 1024, "input traversal count limit");
      requireThat(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), "invalid input name");
      const child = `${path}/${name}`;
      const stat = lstatSync(join(root, child));
      if (stat.isDirectory()) {
        requireThat(!name.includes("."), "unexpected input directory");
        visit(child, depth + 1);
      } else {
        if (excluded(child)) {
          regular(root, child);
          continue;
        }
        requireThat(/\.(?:tsx?|css)$/.test(child), "unregistered input kind");
        add(child);
      }
      requireThat(files.size <= 512, "input file-count limit");
    }
  };
  for (const path of INPUT_ROOTS) visit(path, 0);
  const raw = files.get(`${PATCH_DIRECTORY}manifest.json`) as Buffer;
  const rows = patchManifest(raw);
  const names = ["manifest.json", ...rows.map((row) => row.patch)].sort();
  requireThat(
    canonical(readdirSync(join(root, PATCH_DIRECTORY)).sort()) === canonical(names),
    "patch inventory mismatch",
  );
  for (const row of rows) add(`${PATCH_DIRECTORY}${row.patch}`);
  requireThat(
    [...files.values()].reduce((sum, data) => sum + data.length, 0) <= 8 * 1024 * 1024 &&
      new Set([...files.keys()].map((path) => path.toLowerCase())).size === files.size,
    "input size/case collision",
  );
  packages(files);
  return {
    mode: "local" as const,
    files,
    sourceLockSha256,
    inventorySha256: inventoryHash(files),
    patchManifestSha256: sha256(raw),
    policySha256: sha256(POLICY),
  };
}
