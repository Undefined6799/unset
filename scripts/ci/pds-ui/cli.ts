import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireThat, sha256 } from "./archive.ts";
import { type Lock, parseLock } from "./contract.ts";
import { compareImages, PACKAGES, verifyArtifact, verifySource } from "./verify.ts";
export const ROOT = resolve(import.meta.dirname, "../../..");
export function readBounded(path: string): Buffer {
  const stat = lstatSync(path);
  requireThat(stat.isFile() && stat.size <= 512 * 1024 * 1024, "input must be a bounded regular file");
  return readFileSync(path);
}
export function readArtifact(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let bytes = 0;
  const visit = (directory: string, prefix: string, depth: number): void => {
    requireThat(depth <= 32 && lstatSync(directory).isDirectory(), "artifact directory limit or invalid type");
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        visit(path, `${prefix}${name}/`, depth + 1);
        continue;
      }
      bytes += stat.size;
      requireThat(
        stat.isFile() && bytes <= 128 * 1024 * 1024 && files.size < 10_000,
        "artifact size/file limit or invalid type",
      );
      files.set(`${prefix}${name}`, readBounded(path));
    }
  };
  visit(dir, "", 0);
  return files;
}
export function cleanRevision(root: string): string {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 30_000 }).trim();
  requireThat(git(["status", "--porcelain", "--untracked-files=all"]) === "", "build checkout must be clean");
  const revision = git(["rev-parse", "HEAD"]);
  requireThat(/^[0-9a-f]{40}$/.test(revision), "invalid Unset revision");
  return revision;
}
export async function verifyInputs(
  lock: Lock,
  source: Buffer,
  base: Buffer,
  candidate: Buffer,
  candidateDigest: string,
  artifact: Map<string, Buffer>,
) {
  await verifySource(source, lock.source);
  const baseDigest = lock.base.ref.slice(lock.base.ref.lastIndexOf("@") + 1);
  const result = await compareImages(base, baseDigest, candidate, candidateDigest, lock.base.platform);
  for (const [name, version] of Object.values(PACKAGES)) {
    const path = `app/node_modules/.pnpm/${name.replace("/", "+")}@${version}/node_modules/${name}/package.json`;
    const entry = result.packages.get(path);
    requireThat(entry?.header.type === "file" || entry?.header.type === "link", "missing image package");
    const pkg = JSON.parse(entry.data.toString());
    requireThat(pkg.name === name && pkg.version === version, "image/source package drift");
  }
  const count = verifyArtifact(artifact);
  const installed = new Map<string, Buffer>();
  for (const [path, entry] of result.ui) {
    if (entry.header.type === "directory") continue;
    requireThat(entry.header.type === "file", "installed UI must contain regular files only");
    installed.set(path, entry.data);
  }
  requireThat(
    installed.size === artifact.size && [...artifact].every(([name, data]) => installed.get(name)?.equals(data)),
    "installed UI differs from build artifact",
  );
  verifyArtifact(installed);
  const artifactSha256 = sha256(
    JSON.stringify([...artifact].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => [path, sha256(data)])),
  );
  return {
    candidateDigest,
    base: lock.base,
    source: lock.source,
    builder: lock.builder,
    artifactSha256,
    manifestSha256: sha256(artifact.get("bundle-manifest.json") as Buffer),
    manifestFiles: count,
    outsideEntries: result.outsideEntries,
  };
}
async function main(): Promise<void> {
  const [
    separator,
    lockPath,
    sourcePath,
    basePath,
    candidatePath,
    digest,
    artifactPath,
    expectedRevision,
    expectedLockHash,
    ...extra
  ] = process.argv.slice(2);
  requireThat(
    separator === "--" &&
      lockPath &&
      sourcePath &&
      basePath &&
      candidatePath &&
      digest &&
      artifactPath &&
      expectedRevision &&
      expectedLockHash &&
      extra.length === 0,
    "usage: cli.ts -- LOCK SOURCE BASE CANDIDATE CANDIDATE_DIGEST ARTIFACT UNSET_REVISION LOCK_SHA256",
  );
  const revision = cleanRevision(ROOT);
  const rawLock = readBounded(lockPath);
  requireThat(
    revision === expectedRevision && sha256(rawLock) === expectedLockHash,
    "Unset revision/source lock drift",
  );
  const proof = await verifyInputs(
    parseLock(rawLock.toString()),
    readBounded(sourcePath),
    readBounded(basePath),
    readBounded(candidatePath),
    digest,
    readArtifact(artifactPath),
  );
  requireThat(cleanRevision(ROOT) === revision, "checkout changed during verification");
  console.log(JSON.stringify({ schema: 1, unsetRevision: revision, sourceLockSha256: expectedLockHash, ...proof }));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
