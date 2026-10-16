// The web image carries every workspace its server reaches (P2.06). node_modules/@unset/* are links into the
// workspace folders, so a folder the runtime stage does not copy leaves a dangling link and the server exits at
// startup with ERR_MODULE_NOT_FOUND. web_image_boots_to_config_check sees that only after a CI image build; this reads
// the Dockerfile and the package manifests, so `npm run check` sees it first.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

/** Each workspace's folder by package name, from the root manifest's `<folder>/*` globs. */
function workspaceFolders(): Map<string, string> {
  const folders = new Map<string, string>();
  for (const glob of json("package.json").workspaces as string[]) {
    const parent = glob.replace(/\/\*$/, "");
    for (const entry of readdirSync(join(ROOT, parent))) {
      const manifest = `${parent}/${entry}/package.json`;
      if (existsSync(join(ROOT, manifest))) folders.set(json(manifest).name, `${parent}/${entry}`);
    }
  }
  return folders;
}

/** The workspace folders `from` needs at runtime: itself and its dependencies, direct or through other workspaces. */
function runtimeClosure(from: string, folders: Map<string, string>): Set<string> {
  const seen = new Set([from]);
  for (const folder of seen) {
    for (const name of Object.keys(json(`${folder}/package.json`).dependencies ?? {})) {
      const dependency = folders.get(name);
      if (dependency !== undefined) seen.add(dependency);
    }
  }
  return seen;
}

test("web_image_copies_every_workspace_the_server_reaches", () => {
  const dockerfile = readFileSync(join(ROOT, "deployment/images/node-app.Dockerfile"), "utf8");
  const copied = [...dockerfile.matchAll(/^COPY --from=deps \/app\/(\S+) \/app\/\1$/gm)].map((match) => match[1]);
  const needed = runtimeClosure("interfaces/http", workspaceFolders());
  expect(copied.length).toBeGreaterThan(0);
  expect(needed.size).toBeGreaterThan(1);
  const missing = [...needed]
    .filter((folder) => folder !== "apps/web") // the runtime stage copies its server build, not its source
    .filter((folder) => !copied.some((dir) => folder === dir || folder.startsWith(`${dir}/`)));
  expect(missing).toEqual([]);
});
