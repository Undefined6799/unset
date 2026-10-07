// The mirror scan per stage (P1.28v; architecture record 2026-10-07-p128-edge-bases-and-ratelimit-adr, "Mirror scan
// of build-only images"): a `build` entry fails only on CRITICAL and reports HIGH as a warning, a `runtime` entry
// fails on HIGH and CRITICAL, an entry without a stage fails, and the loop stops at the first failing image. The
// test runs mirror.yml's own scan script, under the shell the step declares (P1.28w), with a stand-in `docker` that
// answers from a findings table, on mirror lists written here (generated, because a real digest is long hex). The
// shipped-image jobs in images.yml are unchanged and only asserted.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
type Step = { name?: string; run?: string; shell?: string };
type Workflow = { jobs: Record<string, { env?: Record<string, string>; steps?: Step[] }> };
const workflow = (file: string): Workflow =>
  parse(readFileSync(join(ROOT, ".github", "workflows", file), "utf8")) as Workflow;

const step = workflow("mirror.yml").jobs.scan?.steps?.find((candidate) => candidate.name?.startsWith("Scan"));
const scanStep = step?.run ?? "";

// How Actions runs a `run:` step on Linux for its `shell:` key (docs.github.com, workflow syntax,
// jobs.<job_id>.steps[*].shell): unspecified is `bash -e {0}`, and `bash` is `bash --noprofile --norc -eo pipefail
// {0}`. Any other key is not one this test models, so it fails.
function actionsShell(shell: string | undefined): string[] {
  if (shell === undefined) return ["-e"];
  if (shell === "bash") return ["--noprofile", "--norc", "-eo", "pipefail"];
  throw new Error(`no model for shell: ${shell}`);
}

// Stands in for `docker run … image --exit-code N --severity S … SOURCE`: it logs the call, and exits N when the
// findings table ("source severity" lines) holds a finding at one of S's severities for SOURCE, else 0. A
// "source ERROR" line makes every run for SOURCE fail as Trivy itself would (exit 3), and every call's cache mount is
// logged.
const FAKE_DOCKER = `#!/bin/bash
args=("$@"); source="\${args[-1]}"; code=0; severity=""
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in --exit-code) code="\${args[i+1]}" ;; --severity) severity="\${args[i+1]}" ;; esac
done
echo "scan $source $severity" >> "$FAKE_CALLS"
for arg in "\${args[@]}"; do [[ "$arg" == *:/root/.cache/trivy ]] && echo "cache $arg" >> "$FAKE_CALLS"; done
while read -r found level; do
  [ "$found" = "$source" ] && [ "$level" = ERROR ] && exit 3
  [ "$found" = "$source" ] && [[ ",$severity," == *",$level,"* ]] && exit "$code"
done < "$FAKE_FINDINGS"
exit 0
`;

const digest = (n: number) => `@sha256:${String(n).repeat(64).slice(0, 64)}`;
const SOURCE = { builder: `docker.io/library/b${digest(1)}`, runtime: `docker.io/library/r${digest(2)}` };

type Entry = { source: string; stage?: string };
/** Runs the workflow's scan script on `entries` with `findings`, under the shell Actions uses for the step. */
function scan(entries: Entry[], findings: [string, string][]) {
  const dir = mkdtempSync(join(tmpdir(), "mirror-scan-"));
  const bin = join(dir, "bin");
  spawnSync("mkdir", [bin]);
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  chmodSync(join(bin, "docker"), 0o755);
  const list = entries.map((entry) => ({ ...entry, mirror: "ghcr.io/example/mirror" }));
  writeFileSync(join(dir, "mirror.list.json"), JSON.stringify(list));
  writeFileSync(join(dir, "findings"), findings.map((pair) => `${pair.join(" ")}\n`).join(""));
  writeFileSync(join(dir, "calls"), "");
  writeFileSync(join(dir, "summary"), "");
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    MIRROR_LIST: join(dir, "mirror.list.json"),
    RUNNER_TEMP: dir,
    GITHUB_STEP_SUMMARY: join(dir, "summary"),
    TRIVY_IMAGE: "trivy",
    FAKE_CALLS: join(dir, "calls"),
    FAKE_FINDINGS: join(dir, "findings"),
  };
  const ran = spawnSync("bash", [...actionsShell(step?.shell), "-c", scanStep], {
    env,
    encoding: "utf8",
  });
  const logged = readFileSync(join(dir, "calls"), "utf8").trim().split("\n").filter(Boolean);
  const calls = logged.filter((line) => line.startsWith("scan "));
  const caches = logged.filter((line) => line.startsWith("cache ")).map((line) => line.slice("cache ".length));
  return {
    code: ran.status,
    out: ran.stdout + ran.stderr,
    calls,
    caches,
    summary: readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"),
  };
}

describe("mirror scan per stage", () => {
  test("mirror_scan_fails_on_critical_for_build_entries", () => {
    const builder = { source: SOURCE.builder, stage: "build" };
    const runtime = { source: SOURCE.runtime, stage: "runtime" };
    // A build-only base with HIGH findings passes, and says so as a warning and in the job summary.
    const high = scan([builder, runtime], [[SOURCE.builder, "HIGH"]]);
    expect(high.code, high.out).toBe(0);
    expect(high.out).toContain(`::warning title=mirror::HIGH findings in build-only base ${SOURCE.builder}`);
    expect(high.summary).toContain(SOURCE.builder);
    expect(high.calls).toEqual([
      `scan ${SOURCE.builder} HIGH`,
      `scan ${SOURCE.builder} CRITICAL`,
      `scan ${SOURCE.runtime} HIGH,CRITICAL`,
    ]);
    // A CRITICAL finding in a build-only base fails, and the scan stops there.
    const critical = scan([builder, runtime], [[SOURCE.builder, "CRITICAL"]]);
    expect(critical.code).not.toBe(0);
    expect(critical.calls.some((call) => call.includes(SOURCE.runtime))).toBe(false);
    // A runtime base still fails on HIGH.
    expect(scan([runtime], [[SOURCE.runtime, "HIGH"]]).code).not.toBe(0);
    // An entry without a stage, or with an unknown one, fails before anything is scanned.
    for (const entry of [{ source: SOURCE.builder }, { source: SOURCE.builder, stage: "Build" }]) {
      const missing = scan([entry], []);
      expect(missing.code).not.toBe(0);
      expect(missing.out).toContain(`no known stage for ${SOURCE.builder}`);
      expect(missing.calls).toEqual([]);
    }
    // Every scan keeps --ignore-unfixed and the ignore file.
    expect(scanStep.match(/--ignore-unfixed --ignorefile \.github\/trivyignore\.yaml/g)?.length).toBe(2);
  });

  test("mirror_scan_step_sets_pipefail_shell", () => {
    // Without it the HIGH run's status is tee's, so neither the warning nor a Trivy error reaches the step (P1.28w).
    expect(step?.shell).toBe("bash");
  });

  test("build_stage_trivy_error_fails", () => {
    const builder = { source: SOURCE.builder, stage: "build" };
    const errored = scan([builder], [[SOURCE.builder, "ERROR"]]);
    expect(errored.code, errored.out).toBe(3);
    expect(errored.calls).toEqual([`scan ${SOURCE.builder} HIGH`]);
  });

  test("trivy_runs_share_one_cache_dir", () => {
    const runs = scan(
      [
        { source: SOURCE.builder, stage: "build" },
        { source: SOURCE.runtime, stage: "runtime" },
      ],
      [],
    );
    expect(runs.code, runs.out).toBe(0);
    expect(runs.caches).toHaveLength(3);
    expect(new Set(runs.caches).size).toBe(1);
    // Every Trivy run in the step mounts it, not only the ones this list happens to reach.
    expect(scanStep.match(/-v "\$cache:\/root\/\.cache\/trivy"/g)?.length).toBe(scanStep.match(/docker run /g)?.length);
  });

  test("shipped_image_scan_fails_on_high", () => {
    const jobs = workflow("images.yml").jobs;
    for (const [id, ignore] of [
      ["images", "\\.github/trivyignore\\.yaml"],
      ["edge", "/dev/null"],
    ] as const) {
      const runs = (jobs[id]?.steps ?? []).map((step) => step.run ?? "").join("\n");
      expect(runs, id).toMatch(
        new RegExp(`image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --ignorefile ${ignore}`),
      );
    }
  });
});
