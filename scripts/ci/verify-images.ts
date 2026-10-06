// Verifies every image in a lock before anything runs it (P1.27q; used by the P1.30 deploy preflight and by the
// images workflow on what it just pushed). Each entry must sit in our private registry by digest and carry our
// cosign signature; a first-party entry must also carry SLSA provenance naming this repository, refs/heads/main and
// the images workflow. Fails closed: any error, timeout or unreadable output is a failure.
//
// cosign v3.0.5 (source read at the tag): verify and verify-attestation take `--key` and
// `--insecure-ignore-tlog=true` (no Rekor lookup: we never upload, see the step's ADR), and
// `--new-bundle-format=false` to read the classic signature format our sign step writes (cmd/cosign/cli/options/
// verify.go; certificate.go). verify-attestation prints one DSSE envelope per line with a base64 in-toto payload.
// Provenance shape: SLSA v1 buildDefinition.externalParameters.workflow {repository, ref, path}
// (https://slsa.dev/spec/v1.0/provenance; GitHub Actions build type 1). Unverified against a real registry until the
// first signed push.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type LockEntry = {
  ref: string;
  origin: "first-party" | "upstream";
  upstreamSource?: string;
  verify: "cosign-key";
};
export type ImageLock = Record<string, LockEntry>;
export type CosignRun = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
export type VerifyOptions = { key: string; repository: string; workflow: string; run: CosignRun };
export type VerifyResult = { ok: true } | { ok: false; failures: string[] };

const BRANCH = "refs/heads/main";
const OUR_REGISTRY = /^ghcr\.io\/undefined6799\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/;
const COSIGN_TIMEOUT_MS = 5 * 60_000;

type Workflow = { repository?: unknown; ref?: unknown; path?: unknown };

/** The workflow each provenance statement in verify-attestation's output names; throws on unreadable output. */
function provenanceWorkflows(stdout: string): Workflow[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const envelope = JSON.parse(line) as { payload: string };
      const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
      return statement?.predicate?.buildDefinition?.externalParameters?.workflow ?? {};
    });
}

/** Why the provenance does not name our repository, main and the images workflow, or null when it does. */
function provenanceProblem(stdout: string, options: VerifyOptions): string | null {
  let workflows: Workflow[];
  try {
    workflows = provenanceWorkflows(stdout);
  } catch {
    return "provenance is unreadable";
  }
  if (workflows.length === 0) return "no provenance";
  for (const workflow of workflows) {
    if (workflow.repository !== options.repository) return `provenance names repository ${String(workflow.repository)}`;
    if (workflow.ref !== BRANCH) return `provenance names ref ${String(workflow.ref)}`;
    if (workflow.path !== options.workflow) return `provenance names workflow ${String(workflow.path)}`;
  }
  return null;
}

async function entryProblem(entry: LockEntry, options: VerifyOptions): Promise<string | null> {
  if (entry.verify !== "cosign-key" || !OUR_REGISTRY.test(entry.ref))
    return "ref is not ghcr.io/undefined6799/… by digest";
  const common = ["--key", options.key, "--insecure-ignore-tlog=true", "--new-bundle-format=false"];
  const signature = await options.run(["verify", ...common, entry.ref]);
  if (signature.code !== 0) return `signature does not verify: ${signature.stderr.trim()}`;
  if (entry.origin === "upstream") return null;
  const attestation = await options.run(["verify-attestation", ...common, "--type", "slsaprovenance1", entry.ref]);
  if (attestation.code !== 0) return `provenance does not verify: ${attestation.stderr.trim()}`;
  return provenanceProblem(attestation.stdout, options);
}

export async function verifyImages(lock: ImageLock, options: VerifyOptions): Promise<VerifyResult> {
  // An empty lock would verify nothing and pass; a deploy always runs at least one image.
  if (Object.keys(lock).length === 0) return { ok: false, failures: ["the lock names no images"] };
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
  const lock: ImageLock = JSON.parse(readFileSync(process.argv[2] ?? "deployment/images.lock.json", "utf8"));
  const result = await verifyImages(lock, {
    key: "deployment/cosign.pub",
    repository: "https://github.com/Undefined6799/unset",
    workflow: ".github/workflows/images.yml",
    run: cosign,
  });
  if (!result.ok) {
    for (const failure of result.failures) console.error(failure);
    process.exit(1);
  }
  console.log(`verify-images: ${Object.keys(lock).length} images verified`);
}
