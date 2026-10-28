// The mirror scan per stage (P1.28v; architecture record 2026-10-07-p128-edge-bases-and-ratelimit-adr, "Mirror scan
// of build-only images"): a `build` entry fails only on CRITICAL and reports HIGH as a warning, a `runtime` entry
// fails on HIGH and CRITICAL, and an entry without a stage fails. P1.34m (record
// unset-plan/book-edits/2026-10-13-p134m-pr-scan-new-runtime-pins.md, Amendment 2): a failing image no longer stops
// the loop; every source is scanned, each failing one gets an error annotation naming it, and the step still fails
// at the end. The
// test runs mirror.yml's own scan script, under the shell the step declares (P1.28w), with a stand-in `docker` that
// answers from a findings table, on mirror lists written here (generated, because a real digest is long hex). The
// shipped-image jobs in images.yml are only asserted.
//
// P1.29v: a runtime entry whose lock entry declares `stripped` paths is scanned without them, because every final
// stage on that base deletes them (stripped_paths_removed_in_every_final_stage) and the shipped image is scanned in
// full. P1.29b: a build-only entry is scanned in full, its declared paths included.
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
// logged. A finding may name the image path it sits at ("source severity path"); it is then dropped the way Trivy
// v0.75.0 drops it (pkg/fanal/walker/tar.go:66-81, pkg/fanal/utils/utils.go:86-107): a leading "/" is trimmed, a
// --skip-files path drops that exact file, and a --skip-dirs path drops everything beneath it. Every call's skip
// flags are logged.
const FAKE_DOCKER = `#!/bin/bash
args=("$@"); source="\${args[-1]}"; code=0; severity=""; dirs=(); files=()
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
    --exit-code) code="\${args[i+1]}" ;;
    --severity) severity="\${args[i+1]}" ;;
    --skip-dirs) dirs+=("\${args[i+1]#/}") ;;
    --skip-files) files+=("\${args[i+1]#/}") ;;
    --ignorefile) echo "ignore $source \${args[i+1]}" >> "$FAKE_CALLS" ;;
  esac
done
echo "scan $source $severity" >> "$FAKE_CALLS"
echo "skip $source dirs=\${dirs[*]} files=\${files[*]}" >> "$FAKE_CALLS"
for arg in "\${args[@]}"; do [[ "$arg" == *:/root/.cache/trivy ]] && echo "cache $arg" >> "$FAKE_CALLS"; done
skipped() {
  local at="\${1#/}" entry
  for entry in "\${files[@]}"; do [ "$at" = "$entry" ] && return 0; done
  for entry in "\${dirs[@]}"; do [[ "$at" == "$entry/"* ]] && return 0; done
  return 1
}
while read -r found level at; do
  [ "$found" = "$source" ] && [ "$level" = ERROR ] && exit 3
  [ -n "$at" ] && skipped "$at" && continue
  [ "$found" = "$source" ] && [[ ",$severity," == *",$level,"* ]] && exit "$code"
done < "$FAKE_FINDINGS"
exit 0
`;

const digest = (n: number) => `@sha256:${String(n).repeat(64).slice(0, 64)}`;
const SOURCE = { builder: `docker.io/library/b${digest(1)}`, runtime: `docker.io/library/r${digest(2)}` };

type Entry = { source: string; stage?: string };
type LockEntry = { ref: string; tag: string; digest: string; stripped?: string[] };
/** Runs the workflow's scan script on `entries` with `findings` and `lock`, under the shell Actions uses for the step. */
function scan(entries: Entry[], findings: string[][], lock: Record<string, LockEntry> | unknown[] | null = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mirror-scan-"));
  const bin = join(dir, "bin");
  spawnSync("mkdir", [bin]);
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  chmodSync(join(bin, "docker"), 0o755);
  const list = entries.map((entry) => ({ ...entry, mirror: "ghcr.io/example/mirror" }));
  writeFileSync(join(dir, "mirror.list.json"), JSON.stringify(list));
  if (lock !== null) writeFileSync(join(dir, "bases.lock.json"), JSON.stringify(lock));
  writeFileSync(join(dir, "findings"), findings.map((pair) => `${pair.join(" ")}\n`).join(""));
  writeFileSync(join(dir, "calls"), "");
  writeFileSync(join(dir, "summary"), "");
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    MIRROR_LIST: join(dir, "mirror.list.json"),
    BASES_LOCK: join(dir, "bases.lock.json"),
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
  const skips = logged.filter((line) => line.startsWith("skip ")).map((line) => line.slice("skip ".length));
  const caches = logged.filter((line) => line.startsWith("cache ")).map((line) => line.slice("cache ".length));
  const ignores = logged.filter((line) => line.startsWith("ignore ")).map((line) => line.slice("ignore ".length));
  return {
    code: ran.status,
    out: ran.stdout + ran.stderr,
    calls,
    skips,
    caches,
    ignores,
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
    // A CRITICAL finding in a build-only base fails, and the runtime base after it is still scanned.
    const critical = scan([builder, runtime], [[SOURCE.builder, "CRITICAL"]]);
    expect(critical.code).not.toBe(0);
    expect(critical.calls).toContain(`scan ${SOURCE.runtime} HIGH,CRITICAL`);
    // A runtime base still fails on HIGH.
    expect(scan([runtime], [[SOURCE.runtime, "HIGH"]]).code).not.toBe(0);
    // An entry without a stage, or with an unknown one, fails before anything is scanned.
    for (const entry of [{ source: SOURCE.builder }, { source: SOURCE.builder, stage: "Build" }]) {
      const missing = scan([entry], []);
      expect(missing.code).not.toBe(0);
      expect(missing.out).toContain(`no known stage for ${SOURCE.builder}`);
      expect(missing.calls).toEqual([]);
    }
    // Every scan keeps --ignore-unfixed. Which ignore file is pds_ignorefile_wired_to_pds_scan_only.
    expect(scanStep.match(/--ignore-unfixed --ignorefile "\$ignorefile"/g)?.length).toBe(2);
  });

  test("mirror_scan_step_sets_pipefail_shell", () => {
    // Without it the HIGH run's status is tee's, so neither the warning nor a Trivy error reaches the step (P1.28w).
    expect(step?.shell).toBe("bash");
  });

  test("build_stage_trivy_error_fails", () => {
    const builder = { source: SOURCE.builder, stage: "build" };
    const runtime = { source: SOURCE.runtime, stage: "runtime" };
    const errored = scan([builder, runtime], [[SOURCE.builder, "ERROR"]]);
    expect(errored.code, errored.out).not.toBe(0);
    expect(errored.out).toContain(`::error title=mirror::scan failed (exit 3) for ${SOURCE.builder}`);
    // The errored base gets no CRITICAL run of its own; the next source is still scanned.
    expect(errored.calls).toEqual([`scan ${SOURCE.builder} HIGH`, `scan ${SOURCE.runtime} HIGH,CRITICAL`]);
  });

  test("mirror_scan_reports_every_failing_source", () => {
    const third = `docker.io/library/t${digest(3)}`;
    const entries = [
      { source: SOURCE.builder, stage: "build" },
      { source: SOURCE.runtime, stage: "runtime" },
      { source: third, stage: "runtime" },
    ];
    // Two failing sources are both annotated by name, and the step is red.
    const both = scan(entries, [
      [SOURCE.builder, "CRITICAL"],
      [SOURCE.runtime, "HIGH"],
    ]);
    expect(both.code, both.out).not.toBe(0);
    expect(both.out).toContain(`::error title=mirror::scan failed (exit 1) for ${SOURCE.builder}`);
    expect(both.out).toContain(`::error title=mirror::scan failed (exit 1) for ${SOURCE.runtime}`);
    expect(both.out).not.toContain(`for ${third}`);
    // A passing source after a failing one is still scanned.
    expect(both.calls.at(-1)).toBe(`scan ${third} HIGH,CRITICAL`);
    // With nothing failing, nothing is annotated and the step passes.
    const clean = scan(entries, []);
    expect(clean.code, clean.out).toBe(0);
    expect(clean.out).not.toContain("::error");
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
      // P1.29v follow-up (Alex's card 2026-10-28T01:40:52Z): the app image reads the app file (zod only).
      ["images", "\\.github/trivyignore\\.app\\.yaml"],
      ["edge", "/dev/null"],
      // P1.34m: the PR-time scan of a newly pinned runtime base keeps the mirror's runtime rule.
      // The file itself is chosen per source (pds_ignorefile_wired_to_pds_scan_only).
      ["pins", '"\\$ignorefile"'],
    ] as const) {
      const runs = (jobs[id]?.steps ?? []).map((step) => step.run ?? "").join("\n");
      expect(runs, id).toMatch(
        new RegExp(`image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --ignorefile ${ignore}`),
      );
    }
  });

  test("mirror_scan_skips_only_declared_stripped_paths", () => {
    const npm = "/usr/local/lib/node_modules/npm";
    const gosu = "/usr/local/bin/gosu";
    // The lock spells a base as ref, tag and digest; the mirror list joins them as ref:tag@digest.
    const base = { ref: "docker.io/library/r", tag: "1", digest: `sha256:${"2".repeat(64)}`, stripped: [npm, gosu] };
    const runtime = `${base.ref}:${base.tag}@${base.digest}`;
    const lock = { base };
    const entries = [
      { source: runtime, stage: "runtime" },
      { source: SOURCE.builder, stage: "build" },
    ];
    // A finding under a declared directory, or at a declared file, is not reported for that entry.
    const declared = scan(
      entries,
      [
        [runtime, "HIGH", `${npm.slice(1)}/node_modules/undici/package.json`],
        [runtime, "CRITICAL", gosu.slice(1)],
      ],
      lock,
    );
    expect(declared.code, declared.out).toBe(0);
    expect(declared.skips).toContain(
      `${runtime} dirs=${npm.slice(1)} ${gosu.slice(1)} files=${npm.slice(1)} ${gosu.slice(1)}`,
    );
    // An entry the lock declares nothing for is scanned in full, both HIGH runs included.
    expect(declared.skips.filter((line) => line.startsWith(SOURCE.builder))).toEqual([
      `${SOURCE.builder} dirs= files=`,
      `${SOURCE.builder} dirs= files=`,
    ]);
    // An undeclared path is still scanned, and so is a sibling that only shares the declared path's prefix.
    for (const at of [
      "usr/local/lib/node_modules/corepack/package.json",
      "usr/local/lib/node_modules/npm-x/package.json",
    ]) {
      const kept = scan(entries, [[runtime, "HIGH", at]], lock);
      expect(kept.code, at).not.toBe(0);
    }
    // A declared path skips only on its own entry: the same file in a base that declares nothing still fails.
    const other = scan(entries, [[SOURCE.builder, "CRITICAL", gosu.slice(1)]], lock);
    expect(other.code).not.toBe(0);
    // The lock is read, never optional: a missing lock, or one that is not an object, fails before anything is scanned.
    for (const absent of [null, []]) {
      const missing = scan(entries, [], absent);
      expect(missing.code).not.toBe(0);
      expect(missing.calls).toEqual([]);
    }
  });
  test("mirror_scan_build_stage_scans_whole_base", () => {
    // P1.29b (architecture ruling 1, 2026-10-12): a build-only base is scanned in full, its lock's `stripped` paths
    // included, in the HIGH report run and in the failing CRITICAL run; only the runtime-stage run skips them.
    const npm = "/usr/local/lib/node_modules/npm";
    const builderBase = { ref: "docker.io/library/b", tag: "1", digest: `sha256:${"1".repeat(64)}`, stripped: [npm] };
    const builder = `${builderBase.ref}:${builderBase.tag}@${builderBase.digest}`;
    const lock = { builderBase };
    const entries = [{ source: builder, stage: "build" }];
    const high = scan(entries, [[builder, "HIGH", `${npm.slice(1)}/package.json`]], lock);
    expect(high.code, high.out).toBe(0);
    expect(high.out).toContain(`::warning title=mirror::HIGH findings in build-only base ${builder}`);
    expect(high.skips).toEqual([`${builder} dirs= files=`, `${builder} dirs= files=`]);
    const critical = scan(entries, [[builder, "CRITICAL", `${npm.slice(1)}/package.json`]], lock);
    expect(critical.code).not.toBe(0);
  });

  test("pds_ignorefile_wired_to_pds_scan_only", () => {
    const pds = `ghcr.io/bluesky-social/pds:0.4.5037${digest(4)}`;
    const lookalike = `ghcr.io/bluesky-social/pds-extra:1${digest(6)}`;
    const caddy = `docker.io/library/caddy:2.11.7-alpine${digest(5)}`;
    const ran = scan(
      [
        { source: caddy, stage: "runtime" },
        { source: pds, stage: "runtime" },
        { source: lookalike, stage: "runtime" },
        { source: SOURCE.builder, stage: "build" },
      ],
      [],
    );
    expect(ran.code, ran.out).toBe(0);
    expect(ran.ignores).toEqual([
      `${caddy} .github/trivyignore.yaml`,
      `${pds} .github/trivyignore.pds.yaml`,
      `${lookalike} .github/trivyignore.yaml`,
      `${SOURCE.builder} .github/trivyignore.yaml`,
      `${SOURCE.builder} .github/trivyignore.yaml`,
    ]);
    // The PDS file is selected by the case, never passed as the default --ignorefile literal.
    expect(scanStep).toContain("ignorefile=.github/trivyignore.yaml");
    expect(scanStep).toContain("ghcr.io/bluesky-social/pds:*|ghcr.io/bluesky-social/pds@*)");
    expect(scanStep).not.toMatch(/--ignorefile \.github\/trivyignore\.pds\.yaml/);

    const jobs = workflow("images.yml").jobs;
    const runsOf = (id: string) => (jobs[id]?.steps ?? []).map((item) => item.run ?? "").join("\n");
    const pins = runsOf("pins");
    expect(pins).toContain("ignorefile=.github/trivyignore.yaml");
    expect(pins).toContain("ghcr.io/bluesky-social/pds:*|ghcr.io/bluesky-social/pds@*)");
    expect(pins).toContain('--ignorefile "$ignorefile"');
    expect(pins).not.toMatch(/--ignorefile \.github\/trivyignore\.pds\.yaml/);
    for (const id of ["images", "edge", "scan-image"]) {
      const runs = runsOf(id);
      expect(runs, id).not.toContain("trivyignore.pds.yaml");
    }
    // P1.33u: the secret scan of our own images reads no ignore file.
    expect(runsOf("scan-image")).toContain("rootfs --scanners secret --exit-code 1 --ignorefile /dev/null");
    expect(runsOf("images")).toContain("--ignorefile .github/trivyignore.app.yaml");
    expect(runsOf("edge")).toContain("--ignorefile /dev/null");
  });
});
