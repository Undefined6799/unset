import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "../..");
// A subprocess runs the existing tooling contract across TypeScript project roots.
function recipeContract(
  directory: string,
): { base: { ref: string; platform: string }; builder: { ref: string } } | null {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'const {recipeContract}=await import("./scripts/ci/pds-ui/contract.ts");console.log(JSON.stringify(recipeContract(process.argv[1])));',
        directory,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
}
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("base64");

test("paired_recipe_matches_the_locked_official_and_builder_images", () => {
  const paired = recipeContract(root);
  expect(paired).not.toBeNull();
  const bases = JSON.parse(readFileSync(join(root, "deployment/images/bases.lock.json"), "utf8"));
  for (const [input, base] of [
    [paired?.base, bases.pds],
    [paired?.builder, bases.node],
  ]) {
    expect(input?.ref).toBe(`${base.ref}:${base.tag}@${base.digest}`);
  }
  expect(paired?.base.platform).toBe("linux/amd64");
});

// Execute the finalizer actually embedded in the Dockerfile, without a Docker dependency.
function finalize(files: Record<string, string>, manifest: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "pds-manifest-"));
  try {
    for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
    const path = join(dir, "bundle-manifest.json");
    writeFileSync(path, JSON.stringify(manifest));
    const recipe = readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8");
    const program = /node -e '([^']+)' "\$dist"/.exec(recipe)?.[1];
    expect(program, "Dockerfile finalizer program").toBeDefined();
    const result = spawnSync(process.execPath, ["-e", program as string, dir], { encoding: "utf8" });
    return {
      status: result.status,
      output: readFileSync(path, "utf8"),
      files: Object.fromEntries(Object.keys(files).map((name) => [name, readFileSync(join(dir, name), "utf8")])),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("manifest_finalization_changes_only_hashes_and_preserves_final_asset_bytes", () => {
  const files = { "entry.js": "// final chunk\n", "style.css": "body {}\n", "entry.js.map": "{}" };
  const manifest = {
    "entry.js": { type: "chunk", sha256: "stale", name: "account-page", isEntry: true, dynamicImports: [] },
    "style.css": { type: "asset", sha256: "stale", mime: "text/css" },
    "entry.js.map": { type: "asset", sha256: "stale" },
  };
  const result = finalize(files, manifest);
  expect(result.status).toBe(0);
  expect(result.files).toEqual(files);
  const expected = Object.fromEntries(
    Object.entries(manifest).map(([name, item]) => [
      name,
      { ...item, sha256: hash(files[name as keyof typeof files]) },
    ]),
  );
  expect(result.output).toBe(JSON.stringify(expected, null, 2));
  expect(finalize(files, expected).output).toBe(result.output);
});

test.each([
  { "missing.js": { type: "asset", sha256: "stale" } },
  { "../outside": { type: "asset", sha256: "stale" } },
  { "entry.js": { type: "asset", sha256: "stale", data: "c3RhbGU=" } },
  { "entry.js": { type: "chunk", sha256: "stale", dynamicImports: ["missing.js"] } },
])("manifest_finalizer_rejects_bad_references_without_writing_partial_metadata: %j", (manifest) => {
  const result = finalize({ "entry.js": "final" }, manifest);
  expect(result.status).not.toBe(0);
  expect(result.output).toBe(JSON.stringify(manifest));
});

test.each([
  ["runtime config", (s: string) => `${s}\nUSER node\n`],
  ["source checksum", (s: string) => s.replace("ADD --checksum=sha256:", "ADD --checksum=sha256:0")],
  ["artifact stage", (s: string) => s.replace("FROM scratch AS ui-artifact", "FROM scratch AS other")],
])("assembly_registration_refuses_actual_recipe_drift: %s", (_name, mutate) => {
  const dir = mkdtempSync(join(tmpdir(), "pds-recipe-"));
  try {
    const fixture = join(dir, "deployment/pds");
    mkdirSync(fixture, { recursive: true });
    writeFileSync(join(fixture, "source.lock.json"), readFileSync(join(import.meta.dirname, "source.lock.json")));
    writeFileSync(join(fixture, "Dockerfile"), mutate(readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8")));
    expect(() => recipeContract(dir)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.each(["none", "node version", "package version", "lockfile", "package manager", "source revision"])(
  "source_input_assertions_reject_drift_before_install: %s",
  (drift) => {
    const dir = mkdtempSync(join(tmpdir(), "pds-source-"));
    try {
      const lock = JSON.parse(readFileSync(join(import.meta.dirname, "source.lock.json"), "utf8"));
      const lockfile = "locked upstream dependencies";
      lock.source.lockSha256 = createHash("sha256").update(lockfile).digest("hex");
      if (drift === "source revision") lock.source.revision = "0".repeat(40);
      const lockPath = join(dir, "source.lock.json");
      writeFileSync(lockPath, JSON.stringify(lock));
      writeFileSync(join(dir, "pnpm-lock.yaml"), drift === "lockfile" ? "changed" : lockfile);
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ packageManager: drift === "package manager" ? "pnpm@11.10.0" : "pnpm@11.11.0" }),
      );
      for (const [path, name, version] of [
        ["packages/pds", "@atproto/pds", "0.5.37"],
        ["packages/oauth/oauth-provider", "@atproto/oauth-provider", "0.23.1"],
        ["packages/oauth/oauth-provider-ui", "@atproto/oauth-provider-ui", "0.10.5"],
      ]) {
        const target = join(dir, path as string);
        mkdirSync(target, { recursive: true });
        writeFileSync(
          join(target, "package.json"),
          JSON.stringify({ name, version: drift === "package version" ? "0.0.0" : version }),
        );
      }
      const recipe = readFileSync(join(import.meta.dirname, "Dockerfile"), "utf8");
      const program = /node -e '([^']+)' \/source.lock.json/.exec(recipe)?.[1];
      expect(program).toBeDefined();
      // Execute the unchanged assertion with builder metadata, independent of the host Node version.
      // Node 26.12.0 node:vm runInNewContext supplies the fixture global without changing the host process.
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          `require("node:vm").runInNewContext(process.argv[1], {
            require,
            process: { argv: ["node", process.argv[2]], versions: { node: process.argv[3] } },
          });`,
          program as string,
          lockPath,
          drift === "node version" ? "0.0.0" : lock.builder.node,
        ],
        { cwd: dir },
      );
      expect(result.status === 0).toBe(drift === "none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
