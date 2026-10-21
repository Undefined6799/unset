// Actual checkout observation, selected scratch context and detached proof binding.
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withoutGitEnv } from "../../guards/git-env.ts";
import { requireThat, sha256 } from "./archive.ts";
import { parseLock, recipeContract } from "./contract.ts";
import { excluded, INPUT_ROOTS, inventoryHash, localInputs, regular } from "./local-inputs.ts";
import { canonical, PATCH_DIRECTORY } from "./source-patches.ts";

const POLICY = canonical({ schema: 1, selection: "pds-presentation-v1" });
const git = (root: string, args: string[]): Buffer =>
  execFileSync("git", args, { cwd: root, env: withoutGitEnv(), timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
export function cleanRevision(root: string): string {
  requireThat(
    git(root, ["status", "--porcelain", "--untracked-files=all"]).length === 0,
    "build checkout must be clean",
  );
  const revision = git(root, ["rev-parse", "HEAD"]).toString().trim();
  requireThat(/^[0-9a-f]{40}$/.test(revision), "invalid Unset revision");
  return revision;
}
export function observeInputs(root: string) {
  const revision = cleanRevision(root);
  const observed = localInputs(root);
  const tracked = new Map(
    git(root, ["ls-tree", "-rz", "HEAD"])
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((row) => {
        const [metadata, path] = row.split("\t") as [string, string];
        return [path, metadata.split(" ")[0]];
      }),
  );
  for (const [path, bytes] of observed.files)
    requireThat(
      tracked.get(path) === "100644" && git(root, ["show", `HEAD:${path}`]).equals(bytes),
      "input differs from regular clean HEAD",
    );
  const selected = (path: string) => !excluded(path) && INPUT_ROOTS.some((dir) => path.startsWith(`${dir}/`));
  if (observed.mode === "local")
    requireThat(
      [...tracked.keys()].filter(selected).every((path) => observed.files.has(path)),
      "omitted tracked input",
    );
  requireThat(
    canonical(recipeContract(root)) ===
      canonical(parseLock((observed.files.get("deployment/pds/source.lock.json") as Buffer).toString())),
    "observed recipe/source lock mismatch",
  );
  requireThat(cleanRevision(root) === revision, "HEAD changed during input observation");
  return { revision, ...observed };
}
export type Observation = ReturnType<typeof observeInputs>;
export function inputProof(observed: Observation) {
  requireThat(
    observed.sourceLockSha256 === sha256(observed.files.get("deployment/pds/source.lock.json") as Buffer),
    "source lock proof mismatch",
  );
  if (observed.mode === "local")
    requireThat(
      observed.inventorySha256 === inventoryHash(observed.files) &&
        observed.patchManifestSha256 === sha256(observed.files.get(`${PATCH_DIRECTORY}manifest.json`) as Buffer) &&
        observed.policySha256 === sha256(POLICY),
      "local inventory/manifest proof mismatch",
    );
  const {
    revision: unsetRevision,
    mode: buildMode,
    sourceLockSha256,
    inventorySha256: localInventorySha256,
    patchManifestSha256,
    policySha256,
  } = observed;
  return { unsetRevision, buildMode, sourceLockSha256, localInventorySha256, patchManifestSha256, policySha256 };
}
export function sameInputs(before: Observation, after: Observation): void {
  requireThat(
    canonical(inputProof(before)) === canonical(inputProof(after)) &&
      inventoryHash(before.files) === inventoryHash(after.files),
    "checkout/input proof drift",
  );
}
export function stageInputs(observed: Observation, destination: string): void {
  requireThat(
    observed.mode === "local" &&
      observed.inventorySha256 === inventoryHash(observed.files) &&
      lstatSync(destination).isDirectory() &&
      readdirSync(destination).length === 0,
    "selected context/digest mismatch",
  );
  for (const [path, bytes] of observed.files) {
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    writeFileSync(join(destination, path), bytes, { flag: "wx" });
  }
  verifyContext(observed, destination);
}
/** Independently re-read the entire selected tree immediately before/after both builds. */
export function verifyContext(observed: Observation, destination: string): void {
  const files = new Map<string, Buffer>();
  const visit = (path: string): void => {
    requireThat(lstatSync(join(destination, path)).isDirectory(), "selected context directory type");
    for (const name of readdirSync(join(destination, path))) {
      const child = path ? `${path}/${name}` : name;
      if (lstatSync(join(destination, child)).isDirectory()) {
        requireThat(
          [...observed.files.keys()].some((file) => file.startsWith(`${child}/`)),
          "extra selected context directory",
        );
        visit(child);
      } else {
        requireThat(observed.files.has(child), "extra selected context file");
        files.set(child, regular(destination, child));
      }
    }
  };
  visit("");
  requireThat(
    files.size === observed.files.size && inventoryHash(files) === observed.inventorySha256,
    "selected context changed",
  );
}
export function buildCommands(observed: Observation, platform: string, scratch: string): string[][] {
  inputProof(observed);
  const common = [
    "buildx",
    "build",
    "--platform",
    platform,
    "--file",
    observed.mode === "local" ? join(scratch, "context/deployment/pds/Dockerfile") : "deployment/pds/Dockerfile",
  ];
  if (observed.mode === "local") common.push("--build-arg", `UNSET_INPUTS_SHA256=${observed.inventorySha256}`);
  const context = observed.mode === "local" ? join(scratch, "context") : "deployment/pds";
  return [
    [...common, "--target", "ui-artifact", "--output", `type=local,dest=${join(scratch, "artifact")}`, context],
    [...common, "--load", "--iidfile", join(scratch, "iid"), context],
  ];
}
