// Verifies every image in a lock before anything runs it (P1.27q; keyless since P1.27s, ADR 0033). Each entry must sit in
// our registry by digest and carry a keyless cosign signature whose certificate names exactly the workflow that signs
// that kind of image: publish-images.yml for first-party images, mirror.yml for mirrors, both on refs/heads/main of
// this repository, issued by GitHub Actions' OIDC issuer. A first-party entry must also carry SLSA provenance naming
// this repository, refs/heads/main and publish-images.yml, and one source commit equal to the entry's gitCommit (P2.26h),
// so the lock says which revision each image was built from and cannot pick another signed build. Fails closed: any error, timeout or unreadable output is a
// failure, and no flag that skips the transparency log is ever passed.
//
// cosign v3.1.3 (source read at the tag, cmd/cosign/cli/options/certificate.go and verify.go): verify and
// verify-attestation take --certificate-identity and --certificate-oidc-issuer (exact; the -regexp forms are never
// used), --certificate-github-workflow-repository and --certificate-github-workflow-ref (the Fulcio certificate's
// repository and ref extensions), and --trusted-root for offline trust material. The new bundle format, with its Rekor
// inclusion proof, is the default and is read from the registry. verify-attestation is taken to print one DSSE
// envelope per line with a base64 in-toto payload. Provenance shape: SLSA v1
// buildDefinition.externalParameters.workflow {repository, ref, path} (https://slsa.dev/spec/v1.0/provenance; GitHub
// Actions build type 1), with buildDefinition.resolvedDependencies [{uri, digest: {gitCommit}}] as publish-images.yml
// writes it (https://slsa.dev/spec/v1.0/provenance#resourcedescriptor). Unverified against a real registry until publish-images.yml's first run on main.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type LockEntry = {
  ref: string;
  origin: "first-party" | "upstream";
  upstreamSource?: string;
  /** First-party only: the commit publish-images.yml built it from, as its provenance names it. */
  gitCommit?: string;
  verify: "cosign-keyless";
};
export type ImageLock = Record<string, LockEntry>;
export type CosignRun = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
/** `repository` is owner/name; `trustedRoot`, when set, makes verification offline (P2.26b passes the committed one). */
export type VerifyOptions = { repository: string; trustedRoot?: string; run: CosignRun };
export type VerifyResult = { ok: true } | { ok: false; failures: string[] };

const BRANCH = "refs/heads/main";
const ISSUER = "https://token.actions.githubusercontent.com";
const OWNER_NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
/** The one workflow whose certificate each kind of entry must carry (ADR 0033, Decision 2). */
const SIGNER = { "first-party": ".github/workflows/publish-images.yml", upstream: ".github/workflows/mirror.yml" };
const ENTRY_KEYS = new Set(["ref", "origin", "upstreamSource", "gitCommit", "verify"]);
const COMMIT = /^[0-9a-f]{40}$/;
const OUR_REGISTRY = /^ghcr\.io\/undefined6799\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/;
const COSIGN_TIMEOUT_MS = 5 * 60_000;

type Workflow = { repository?: unknown; ref?: unknown; path?: unknown };
type Build = { workflow: Workflow; sources: unknown };

/** The workflow and sources each provenance statement in verify-attestation's output names; throws on unreadable output. */
function provenanceBuilds(stdout: string): Build[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const envelope = JSON.parse(line) as { payload: string };
      const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
      const definition = statement?.predicate?.buildDefinition;
      return { workflow: definition?.externalParameters?.workflow ?? {}, sources: definition?.resolvedDependencies };
    });
}

/** The one commit the sources name on this repository's main, or null for none, several or another source. */
function sourceCommit(sources: unknown, repository: string): unknown {
  if (!Array.isArray(sources) || sources.length !== 1) return null;
  const [source] = sources as { uri?: unknown; digest?: { gitCommit?: unknown } }[];
  return source?.uri === `git+${repository}@${BRANCH}` ? (source.digest?.gitCommit ?? null) : null;
}

/** Why the provenance does not name our repository, main, publish-images.yml and the entry's commit, or null. */
function provenanceProblem(stdout: string, entry: LockEntry, options: VerifyOptions): string | null {
  let builds: Build[];
  try {
    builds = provenanceBuilds(stdout);
  } catch {
    return "provenance is unreadable";
  }
  if (builds.length === 0) return "no provenance";
  const repository = `https://github.com/${options.repository}`;
  for (const { workflow, sources } of builds) {
    if (workflow.repository !== repository) return `provenance names repository ${String(workflow.repository)}`;
    if (workflow.ref !== BRANCH) return `provenance names ref ${String(workflow.ref)}`;
    if (workflow.path !== SIGNER["first-party"]) return `provenance names workflow ${String(workflow.path)}`;
    const commit = sourceCommit(sources, repository);
    if (commit === null) return "provenance does not name one source commit on main";
    if (commit !== entry.gitCommit) return `provenance names commit ${String(commit)}, not ${entry.gitCommit}`;
  }
  return null;
}

/** The exact certificate checks for one kind of entry; never a -regexp flag, never a tlog opt-out. */
function identityFlags(entry: LockEntry, options: VerifyOptions): string[] {
  const identity = `https://github.com/${options.repository}/${SIGNER[entry.origin]}@${BRANCH}`;
  const flags = ["--certificate-identity", identity, "--certificate-oidc-issuer", ISSUER];
  flags.push(
    "--certificate-github-workflow-repository",
    options.repository,
    "--certificate-github-workflow-ref",
    BRANCH,
  );
  return options.trustedRoot === undefined ? flags : [...flags, "--trusted-root", options.trustedRoot];
}

async function entryProblem(entry: LockEntry, options: VerifyOptions): Promise<string | null> {
  const extra = Object.keys(entry).find((key) => !ENTRY_KEYS.has(key));
  if (extra !== undefined) return `the entry names ${extra}; the signer is fixed by its origin`;
  if (entry.verify !== "cosign-keyless" || !Object.hasOwn(SIGNER, entry.origin) || !OUR_REGISTRY.test(entry.ref))
    return "ref is not ghcr.io/undefined6799/… by digest, signed keyless";
  if (entry.origin === "first-party" && !COMMIT.test(entry.gitCommit ?? ""))
    return "a first-party entry names its full lowercase gitCommit";
  if (entry.origin === "upstream" && entry.gitCommit !== undefined) return "an upstream entry names no gitCommit";
  const flags = identityFlags(entry, options);
  const signature = await options.run(["verify", ...flags, entry.ref]);
  if (signature.code !== 0) return `signature does not verify: ${signature.stderr.trim()}`;
  if (entry.origin === "upstream") return null;
  const attestation = await options.run(["verify-attestation", ...flags, "--type", "slsaprovenance1", entry.ref]);
  if (attestation.code !== 0) return `provenance does not verify: ${attestation.stderr.trim()}`;
  return provenanceProblem(attestation.stdout, entry, options);
}

export async function verifyImages(lock: ImageLock, options: VerifyOptions): Promise<VerifyResult> {
  // An empty lock would verify nothing and pass; a deploy always runs at least one image.
  if (Object.keys(lock).length === 0) return { ok: false, failures: ["the lock names no images"] };
  // An identity is built from the repository, so a pattern there would widen it (ADR 0033: exact match only).
  if (!OWNER_NAME.test(options.repository)) return { ok: false, failures: ["the repository is not owner/name"] };
  const failures: string[] = [];
  for (const [name, entry] of Object.entries(lock)) {
    const problem = await entryProblem(entry, options);
    if (problem !== null) failures.push(`${name}: ${problem}`);
  }
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

/** cosign on PATH, with a timeout; a spawn error or timeout reads as a failed verification. */
const cosign: CosignRun = (args) =>
  new Promise((resolve) => {
    execFile("cosign", args, { timeout: COSIGN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error === null ? 0 : 1,
        stdout,
        stderr: error !== null && stderr === "" ? error.message : stderr,
      });
    });
  });

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // verify-images.ts <lock> [--trusted-root <file>]
  const [lockPath = "deployment/images.lock.json", flag, trustedRoot] = process.argv.slice(2);
  if (flag !== undefined && (flag !== "--trusted-root" || trustedRoot === undefined)) {
    console.error("usage: verify-images.ts <lock> [--trusted-root <file>]");
    process.exit(2);
  }
  const lock: ImageLock = JSON.parse(readFileSync(lockPath, "utf8"));
  const result = await verifyImages(lock, {
    repository: "Undefined6799/unset",
    ...(trustedRoot === undefined ? {} : { trustedRoot }),
    run: cosign,
  });
  if (!result.ok) {
    for (const failure of result.failures) console.error(failure);
    process.exit(1);
  }
  console.log(`verify-images: ${Object.keys(lock).length} images verified`);
}
