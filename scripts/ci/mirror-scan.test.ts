// The mirror scan per stage (P1.28v; architecture record 2026-10-07-p128-edge-bases-and-ratelimit-adr, "Mirror scan
// of build-only images"): a `build` entry fails only on CRITICAL and reports HIGH as a warning, a `runtime` entry
// fails on HIGH and CRITICAL, an entry without a stage fails, and the loop stops at the first failing image. The
// test runs mirror.yml's own scan script under bash with a stand-in `docker` that answers from a findings table, on
// mirror lists written here (generated, because a real digest is long hex). The shipped-image jobs in images.yml are
// unchanged and only asserted.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
type Step = { name?: string; run?: string };
type Workflow = { jobs: Record<string, { env?: Record<string, string>; steps?: Step[] }> };
const workflow = (file: string): Workflow =>
  parse(readFileSync(join(ROOT, ".github", "workflows", file), "utf8")) as Workflow;

const scanStep = workflow("mirror.yml").jobs.scan?.steps?.find((step) => step.name?.startsWith("Scan"))?.run ?? "";

// Stands in for `docker run … image --exit-code N --severity S … SOURCE`: it logs the call, and exits N when the
// findings table ("source severity" lines) holds a finding at one of S's severities for SOURCE, else 0.
const FAKE_DOCKER = `#!/bin/bash
args=("$@"); source="\${args[-1]}"; code=0; severity=""
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in --exit-code) code="\${args[i+1]}" ;; --severity) severity="\${args[i+1]}" ;; esac
done
echo "scan $source $severity" >> "$FAKE_CALLS"
while read -r found level; do
  [ "$found" = "$source" ] && [[ ",$severity," == *",$level,"* ]] && exit "$code"
done < "$FAKE_FINDINGS"
exit 0
`;

const digest = (n: number) => `@sha256:${String(n).repeat(64).slice(0, 64)}`;
const SOURCE = { builder: `docker.io/library/b${digest(1)}`, runtime: `docker.io/library/r${digest(2)}` };

type Entry = { source: string; stage?: string };
/** Runs the workflow's scan script on `entries` with `findings`, as Actions runs a `run:` step (bash -eo pipefail). */
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
  const ran = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", scanStep], {
    env,
    encoding: "utf8",
  });
  const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n").filter(Boolean);
  return {
    code: ran.status,
    out: ran.stdout + ran.stderr,
    calls,
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
