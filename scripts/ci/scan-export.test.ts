// images.yml `scan-export` (P1.33u), run as Actions runs a step with no shell key:
// `bash -e` (docs.github.com workflow syntax, jobs.<job_id>.steps[*].shell). Pipefail is
// the script's own `set -o pipefail`, so dropping it is visible. The stand-in `docker`
// exports a tar this test built and answers `trivy rootfs` from flags (Trivy 0.75.0
// docs/guide/references/configuration/cli/trivy_rootfs.md, tag v0.75.0: --scanners,
// --exit-code, --ignorefile, --skip-dirs). ENTRYPOINT's first element is
// `docker inspect --format` (docs.docker.com/reference/cli/docker/inspect/).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
const GH_OPEN = `$${"{{"}`;
const PIN = "aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa";
const gh = (inner: string): string => `$${"{{"} ${inner} }}`;

type Step = { name?: string; run?: string; shell?: string };
type Job = {
  needs?: string[] | string;
  if?: string;
  "continue-on-error"?: boolean;
  env?: Record<string, string>;
  strategy?: { "fail-fast"?: boolean; matrix?: { include?: string } };
  steps?: Step[];
};
type Workflow = { jobs: Record<string, Job> };
const wf = parse(readFileSync(join(ROOT, ".github", "workflows", "images.yml"), "utf8")) as Workflow;

const runsOf = (job: Job | undefined): string => (job?.steps ?? []).map((step) => step.run ?? "").join("\n");
const asList = (needs: Job["needs"]): string[] => (needs === undefined ? [] : Array.isArray(needs) ? needs : [needs]);

const FAKE_DOCKER = `#!/bin/bash
printf '%s\\n' "$*" >> "$FAKE_CALLS"
case "$1" in
  create)
    printf 'create %s\\n' "$2" >> "$FAKE_CALLS"
    printf '%s\\n' "cid-1"
    ;;
  export)
    if [ -n "\${FAKE_TAR:-}" ] && [ -f "$FAKE_TAR" ]; then cat "$FAKE_TAR"; fi
    exit "\${FAKE_EXPORT_STATUS:-0}"
    ;;
  rm) exit 0 ;;
  inspect)
    printf '%s\\n' "\${FAKE_ENTRYPOINT:-}"
    ;;
  run)
    shift
    args=("$@"); image=""; sub=""; scanners=""; exitcode=""; ignore=""; skip=0; seen=0; i=0
    while [ "$i" -lt "\${#args[@]}" ]; do
      a="\${args[$i]}"
      if [ "$seen" -eq 0 ]; then
        case "$a" in
          --rm) ;;
          -v|-e|-w|--entrypoint) i=$((i + 1)) ;;
          --*) ;;
          *) image="$a"; seen=1 ;;
        esac
      else
        case "$a" in
          --scanners) i=$((i + 1)); scanners="\${args[$i]}" ;;
          --exit-code) i=$((i + 1)); exitcode="\${args[$i]}" ;;
          --ignorefile) i=$((i + 1)); ignore="\${args[$i]}" ;;
          --timeout) i=$((i + 1)) ;;
          --skip-dirs|--skip-files) skip=1; i=$((i + 1)) ;;
          --*) ;;
          *) [ -z "$sub" ] && sub="$a" ;;
        esac
      fi
      i=$((i + 1))
    done
    printf 'trivy image=%s sub=%s scanners=%s exitcode=%s ignore=%s skip=%s\\n' \\
      "$image" "$sub" "$scanners" "$exitcode" "$ignore" "$skip" >> "$FAKE_CALLS"
    if [ "$skip" -eq 1 ] || [ "$sub" != rootfs ] || [ "$scanners" != secret ]; then
      printf '%s\\n' "1 files scanned"
      exit 0
    fi
    if [ "\${FAKE_ZERO_SCAN:-}" = 1 ]; then
      printf '%s\\n' "0 files scanned"
      exit 0
    fi
    if [ -n "\${FAKE_SECRET:-}" ]; then
      printf '%s\\n' "secret found"
      if [ -n "$exitcode" ]; then exit "$exitcode"; fi
      exit 0
    fi
    printf '%s\\n' "1 files scanned"
    exit 0
    ;;
  *) exit 9 ;;
esac
`;

const COMPLETE: Record<string, string> = {
  "etc/os-release": "ID=unset\n",
  "usr/bin/app": "#!/bin/sh\n",
};

type Setup = {
  files?: Record<string, string>;
  exportStatus?: number;
  entrypoint?: string;
  secret?: boolean;
  zeroScan?: boolean;
};

function pack(dir: string, files: Record<string, string>): string {
  const src = join(dir, "src");
  mkdirSync(src, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const path = join(src, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  const tar = join(dir, "export.tar");
  const ran = spawnSync("tar", ["-cf", tar, "-C", src, "."], { encoding: "utf8" });
  if (ran.status !== 0) throw new Error(ran.stderr);
  return tar;
}

/** Runs the workflow's export step under bash -e with the stand-in docker. */
function scanExport(setup: Setup = {}) {
  const step = wf.jobs["scan-export"]?.steps?.find((candidate) => candidate.name?.startsWith("Scan exported"));
  if (step?.run === undefined) throw new Error("no scan-export step");
  const dir = mkdtempSync(join(tmpdir(), "scan-export-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  chmodSync(join(bin, "docker"), 0o755);
  const image = "sha256:0123abcd";
  writeFileSync(join(dir, "iid"), image);
  writeFileSync(join(dir, "calls"), "");
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    RUNNER_TEMP: dir,
    TRIVY_IMAGE: "trivy:pinned",
    FAKE_CALLS: join(dir, "calls"),
    FAKE_TAR: pack(dir, setup.files ?? COMPLETE),
    FAKE_EXPORT_STATUS: String(setup.exportStatus ?? 0),
    FAKE_ENTRYPOINT: setup.entrypoint ?? "/usr/bin/app",
  };
  if (setup.secret === true) env.FAKE_SECRET = "present";
  if (setup.zeroScan === true) env.FAKE_ZERO_SCAN = "1";
  const ran = spawnSync("bash", ["-e", "-c", step.run], { env, encoding: "utf8" });
  const calls = readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean);
  return { code: ran.status, out: ran.stdout + ran.stderr, calls, image };
}

function trivy(calls: string[]): string {
  return calls.find((line) => line.startsWith("trivy ")) ?? "";
}

describe("scan-export gates the secret scan", () => {
  test("scan_export_job_is_on_the_aggregate", () => {
    const job = wf.jobs["scan-export"];
    const image = wf.jobs["scan-image"];
    expect(job).toBeDefined();
    expect(job?.["continue-on-error"] ?? false).toBe(false);
    expect(job?.if).toBe(image?.if);
    expect(job?.strategy?.["fail-fast"]).toBe(false);
    expect(job?.strategy?.matrix?.include).toBe(gh("fromJSON(needs.discover.outputs.images)"));
    expect(asList(job?.needs)).toEqual(["discover"]);
    expect(job?.env?.TRIVY_IMAGE).toBe(PIN);
    expect(job?.env?.TRIVY_IMAGE).toBe(image?.env?.TRIVY_IMAGE);
    const runs = runsOf(job);
    expect(runs.includes(GH_OPEN)).toBe(false);
    expect(runs).toContain("set -o pipefail");
    expect(runs).toContain('docker create "$APP_IMAGE"');
    expect(runs).not.toContain('docker create "$TRIVY_IMAGE"');
    expect(runs).not.toContain("--skip-dirs");
    expect(runs).not.toContain("--skip-files");
    expect(runs).not.toMatch(/\|\|\s*true/);
    expect(runs).toContain("rootfs --scanners secret --exit-code 1 --ignorefile /dev/null");
    const scan = wf.jobs.scan;
    expect(scan?.needs).toEqual(["discover", "scan-image", "scan-export"]);
    expect(runsOf(scan).includes(GH_OPEN)).toBe(false);
    const images = readFileSync(join(ROOT, ".github", "workflows", "images.yml"), "utf8");
    expect(images).not.toContain("v0.74.0");
    const mirror = readFileSync(join(ROOT, ".github", "workflows", "mirror.yml"), "utf8");
    expect(mirror).toContain("does not yet secret-scan their exported filesystems");
    expect(mirror).toContain("P1.33v adds that scan");
  });

  test("a_secret_fails_and_the_flags_are_the_rootfs_scan", () => {
    const ran = scanExport({ secret: true });
    expect(ran.code, ran.out).not.toBe(0);
    expect(trivy(ran.calls)).toBe(
      "trivy image=trivy:pinned sub=rootfs scanners=secret exitcode=1 ignore=/dev/null skip=0",
    );
    expect(ran.calls).toContain(`create ${ran.image}`);
  });

  test("a_clean_export_passes", () => {
    const ran = scanExport();
    expect(ran.code, ran.out).toBe(0);
    expect(ran.calls).toContain(`create ${ran.image}`);
    expect(trivy(ran.calls)).toContain("ignore=/dev/null");
  });

  test("export_failure_is_red_before_trivy", () => {
    // A valid tar and a failing export: without pipefail, tar's 0 would hide it.
    const ran = scanExport({ exportStatus: 1 });
    expect(ran.code, ran.out).not.toBe(0);
    expect(ran.out).toContain("docker export failed");
    expect(trivy(ran.calls)).toBe("");
  });

  test("zero_files_missing_os_release_or_entrypoint_fail_before_trivy", () => {
    const empty = scanExport({ files: {} });
    expect(empty.code, empty.out).not.toBe(0);
    expect(empty.out).toContain("export contains 0 files");
    expect(trivy(empty.calls)).toBe("");
    const noRelease = scanExport({ files: { "usr/bin/app": "#!/bin/sh\n" } });
    expect(noRelease.code, noRelease.out).not.toBe(0);
    expect(noRelease.out).toContain("export is missing /etc/os-release");
    expect(trivy(noRelease.calls)).toBe("");
    const noEntry = scanExport({
      files: { "etc/os-release": "ID=unset\n", "usr/bin/other": "x\n" },
    });
    expect(noEntry.code, noEntry.out).not.toBe(0);
    expect(noEntry.out).toContain("export is missing the ENTRYPOINT target");
    expect(trivy(noEntry.calls)).toBe("");
  });

  test("zero_files_scanned_is_red", () => {
    const ran = scanExport({ zeroScan: true });
    expect(ran.code, ran.out).not.toBe(0);
    expect(ran.out).toContain("0 files scanned");
  });

  test("scan_fails_when_scan_export_is_skipped_or_cancelled", () => {
    const step = wf.jobs.scan?.steps?.[0];
    if (step?.run === undefined) throw new Error("no scan gate");
    const gate = (exportResult: string) =>
      spawnSync("bash", ["-e", "-c", step.run ?? ""], {
        env: {
          PATH: process.env.PATH,
          DISCOVER: "success",
          SCAN_RESULT: "success",
          EXPORT_RESULT: exportResult,
        },
        encoding: "utf8",
      });
    expect(gate("success").status).toBe(0);
    for (const result of ["failure", "cancelled", "skipped"]) {
      const ran = gate(result);
      expect(ran.status, ran.stdout + ran.stderr).not.toBe(0);
    }
  });
});
