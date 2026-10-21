import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { fixtureGitEnv } from "../../guards/git-env.ts";
import { sha256 } from "./archive.ts";
import { buildCommands, observeInputs, sameInputs, stageInputs, verifyContext } from "./build-inputs.ts";
import { INPUT_FILES, INPUT_ROOTS, inventoryHash, localInputs } from "./local-inputs.ts";

const repo = join(import.meta.dirname, "../../..");
const temporary: string[] = [];
function temp() {
  const root = mkdtempSync(join(tmpdir(), "pds-inputs-"));
  temporary.push(root);
  return root;
}
afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});
const write = (root: string, path: string, bytes: string | Buffer) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
};
const policy = '{\n  "schema": 1,\n  "selection": "pds-presentation-v1"\n}\n';
const manifest = '{\n  "patches": [],\n  "schema": 1\n}\n';
const stock = readFileSync(join(repo, "deployment/pds/Dockerfile"));
function fixture(local = true) {
  const root = temp();
  for (const path of INPUT_FILES) {
    if (path === "deployment/pds/build-ui.mjs") write(root, path, 'import fs from "node:fs";\n');
    else if (path === "deployment/pds/build-inputs.json") write(root, path, policy);
    else if (path.endsWith("patches/ui/manifest.json")) write(root, path, manifest);
    else write(root, path, readFileSync(join(repo, path)));
  }
  for (const path of INPUT_ROOTS) write(root, `${path}/view.tsx`, "export const view = 1;\n");
  if (local)
    write(
      root,
      "deployment/pds/Dockerfile",
      stock
        .toString()
        .replace(
          "COPY source.lock.json /source.lock.json",
          "ARG UNSET_INPUTS_SHA256\nCOPY deployment/pds/source.lock.json /source.lock.json\nCOPY deployment/pds/build-ui.mjs /build-ui.mjs",
        ),
    );
  else {
    rmSync(join(root, "deployment/pds/build-inputs.json"));
    rmSync(join(root, "deployment/pds/build-ui.mjs"));
    rmSync(join(root, "deployment/pds/patches"), { recursive: true });
  }
  return root;
}
function git(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, env: fixtureGitEnv(), encoding: "utf8" });
}
function committed(root: string) {
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return root;
}

test("local_inventory_copies_only_complete_registered_bytes", () => {
  const root = committed(fixture());
  const before = observeInputs(root);
  expect(before.mode).toBe("local");
  expect(before.inventorySha256).toMatch(/^[a-f0-9]{64}$/);
  const stage = temp();
  stageInputs(before, stage);
  for (const [path, bytes] of before.files) expect(readFileSync(join(stage, path))).toEqual(bytes);
  expect(sameInputs(before, observeInputs(root))).toBeUndefined();
  write(root, "apps/pds/src/extra.tsx", "export const added = 1;\n");
  expect(() => observeInputs(root)).toThrow();
});

test("stock_recipe_is_fixed_and_local_policy_cannot_downgrade", () => {
  const root = fixture(false);
  expect(localInputs(root).mode).toBe("stock");
  write(root, "deployment/pds/Dockerfile", `${stock.toString()}\nRUN echo local\n`);
  expect(() => localInputs(root)).toThrow();
  const local = fixture();
  rmSync(join(local, "deployment/pds/build-inputs.json"));
  expect(() => localInputs(local)).toThrow();
  write(local, "deployment/pds/build-inputs.json", policy);
  rmSync(join(local, "deployment/pds/patches/ui/manifest.json"));
  expect(() => localInputs(local)).toThrow();
});

test("selection_rejects_extra_inputs", () => {
  for (const path of [
    "apps/pds/src/hidden.json",
    "apps/pds/src/.secret",
    "deployment/pds/patches/ui/extra.patch",
    "deployment/pds/patches/ui/.hidden",
  ]) {
    const root = fixture();
    write(root, path, "secret\n");
    expect(() => localInputs(root)).toThrow();
  }
});

test("selection_rejects_missing_symlink_hardlink_and_nonregular_inputs", () => {
  for (const change of ["symlink", "hardlink", "directory", "ancestor"] as const) {
    const root = fixture();
    const path = join(root, "apps/pds/src/view.tsx");
    if (change === "ancestor") {
      rmSync(dirname(path), { recursive: true });
      symlinkSync(join(root, "shared/ui"), dirname(path));
    } else {
      rmSync(path);
      if (change === "symlink") symlinkSync(join(root, "apps/pds/index.ts"), path);
      if (change === "hardlink") linkSync(join(root, "apps/pds/index.ts"), path);
      if (change === "directory") mkdirSync(path);
    }
    expect(() => localInputs(root)).toThrow();
  }
  const missing = fixture();
  rmSync(join(missing, "apps/pds/index.ts"));
  expect(() => localInputs(missing)).toThrow();
});

test("policy_and_dependency_fields_cannot_extend_the_build_closure", () => {
  for (const bytes of [
    policy.replace('"pds-presentation-v1"', '"all"'),
    policy.replace('"schema": 1', '"schema": 1, "extra": true'),
    policy.replace('"schema": 1', '"schema": 1, "schema": 1'),
  ]) {
    const root = fixture();
    write(root, "deployment/pds/build-inputs.json", bytes);
    expect(() => localInputs(root)).toThrow();
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const root = fixture();
    const pkg = JSON.parse(readFileSync(join(root, "apps/pds/package.json"), "utf8"));
    pkg[field] = { ...pkg[field], "left-pad": "1.0.0" };
    write(root, "apps/pds/package.json", JSON.stringify(pkg));
    expect(() => localInputs(root)).toThrow();
  }
});

test("observations_reject_actual_head_lock_inventory_and_receipt_lies", () => {
  const root = committed(fixture());
  const before = observeInputs(root);
  if (before.mode !== "local") throw new Error("local fixture");
  for (const delta of [
    { revision: "0".repeat(40) },
    { sourceLockSha256: "0".repeat(64) },
    { inventorySha256: "0".repeat(64) },
    { patchManifestSha256: "0".repeat(64) },
  ])
    expect(() => sameInputs(before, { ...before, ...delta })).toThrow();
  write(root, "apps/pds/src/view.tsx", "changed\n");
  expect(() => observeInputs(root)).toThrow();
  git(root, "add", ".");
  git(root, "commit", "-qm", "changed");
  expect(() => sameInputs(before, observeInputs(root))).toThrow();
  write(root, ".gitignore", "apps/pds/src/ignored.ts\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "ignore");
  write(root, "apps/pds/src/ignored.ts", "ignored\n");
  expect(() => observeInputs(root)).toThrow();
});

test("both_build_commands_bind_the_same_selected_context_and_digest", () => {
  const state = observeInputs(committed(fixture()));
  if (state.mode !== "local") throw new Error("local fixture");
  const scratch = temp();
  const commands = buildCommands(state, "linux/amd64", scratch);
  for (const command of commands) {
    expect(command.at(-1)).toBe(join(scratch, "context"));
    expect(command).toContain(`UNSET_INPUTS_SHA256=${state.inventorySha256}`);
    expect(command).not.toContain(repo);
  }
  expect(commands[0]).toContain("ui-artifact");
  expect(commands[1]).toContain("--load");
  const bad = { ...state, inventorySha256: sha256("lie") };
  expect(() => stageInputs(bad, temp())).toThrow();
});

test("selected_context_rejects_poststaging_extra_missing_and_changed_bytes", () => {
  const state = observeInputs(committed(fixture()));
  for (const change of ["extra", "changed", "missing"]) {
    const destination = temp();
    stageInputs(state, destination);
    verifyContext(state, destination);
    if (change === "extra") write(destination, ".env", "secret");
    if (change === "changed") write(destination, "apps/pds/index.ts", "lie");
    if (change === "missing") rmSync(join(destination, "apps/pds/index.ts"));
    expect(() => verifyContext(state, destination)).toThrow();
  }
});

test("local_recipe_refuses_root_glob_json_and_external_stage_copies", () => {
  for (const directive of [
    "COPY . /all",
    "COPY ./ /all",
    "COPY / /all",
    "COPY ./* /all",
    'COPY [".","/all"]',
    "COPY --from=unreviewed /payload /all",
  ]) {
    const root = fixture();
    const recipe = readFileSync(join(root, "deployment/pds/Dockerfile"), "utf8");
    write(
      root,
      "deployment/pds/Dockerfile",
      recipe.replace("ARG UNSET_INPUTS_SHA256", `${directive}\nARG UNSET_INPUTS_SHA256`),
    );
    expect(() => localInputs(root)).toThrow();
  }
});

test("package_browser_alias_and_runtime_entry_injection_are_rejected", () => {
  for (const file of ["apps/pds/package.json", "shared/ui/package.json"]) {
    const root = fixture();
    const pkg = JSON.parse(readFileSync(join(root, file), "utf8"));
    pkg.browser = { react: "left-pad" };
    write(root, file, JSON.stringify(pkg));
    expect(() => localInputs(root)).toThrow();
  }
});

test("inventory_digest_has_independent_canonical_bytes_and_path_order", () => {
  const files = new Map([
    ["b.css", Buffer.from("beta\n")],
    ["a.ts", Buffer.from("alpha\n")],
  ]);
  expect(inventoryHash(files)).toBe("09d0e258389addf34e3d284168b57ca04b1c41d484d88d9c252d3ca792a707b1");
});

test("clean_observation_validates_the_actual_recipe_and_lock_pair", () => {
  for (const change of ["runtime", "lock"]) {
    const root = fixture();
    if (change === "runtime")
      write(
        root,
        "deployment/pds/Dockerfile",
        `${readFileSync(join(root, "deployment/pds/Dockerfile"), "utf8")}\nUSER node\n`,
      );
    else {
      const lock = JSON.parse(readFileSync(join(root, "deployment/pds/source.lock.json"), "utf8"));
      lock.source.archiveSha256 = "0".repeat(64);
      write(root, "deployment/pds/source.lock.json", JSON.stringify(lock));
    }
    committed(root);
    expect(() => observeInputs(root)).toThrow();
  }
});
