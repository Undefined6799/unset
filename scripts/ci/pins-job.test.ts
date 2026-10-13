// images.yml's `pins` job (P1.34m, record unset-plan/book-edits/2026-10-13-p134m-pr-scan-new-runtime-pins.md), run
// as Actions runs it: each step's own script under the shell the step declares, with stand-in `git`, `docker` and
// `curl` that answer from files written here. The scan runs whenever the selection succeeded, so a failed GHCR
// lookup still leaves a scan result while the job stays red; every pin is scanned and every failure is named.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
type Step = { name?: string; id?: string; if?: string; run?: string; shell?: string };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };
const wf = parse(readFileSync(join(ROOT, ".github", "workflows", "images.yml"), "utf8")) as Workflow;
const steps = wf.jobs.pins?.steps ?? [];
const named = (prefix: string): Step => {
  const found = steps.find((candidate) => candidate.name?.startsWith(prefix));
  if (found === undefined) throw new Error(`no pins step named ${prefix}`);
  return found;
};

// Same model as mirror-scan.test.ts: `bash` is `bash --noprofile --norc -eo pipefail {0}` (docs.github.com, workflow
// syntax, jobs.<job_id>.steps[*].shell); no other shell key is modelled.
function actionsShell(shell: string | undefined): string[] {
  if (shell === "bash") return ["--noprofile", "--norc", "-eo", "pipefail"];
  throw new Error(`no model for shell: ${shell}`);
}

// git: fetch does nothing; cat-file -e and show answer from $FAKE_BASE when it exists.
const FAKE_GIT = `#!/bin/bash
case "$1" in
  fetch) exit 0 ;;
  cat-file) test -e "$FAKE_BASE" ;;
  show) cat "$FAKE_BASE" ;;
  *) exit 9 ;;
esac
`;
// docker buildx imagetools inspect prints an image config; docker run stands in for Trivy and exits with
// --exit-code when $FAKE_FINDINGS names the source (the last argument). Every call is logged.
const FAKE_DOCKER = `#!/bin/bash
args=("$@"); source="\${args[-1]}"
echo "docker $1 $source" >> "$FAKE_CALLS"
if [ "$1" = buildx ]; then echo '{"created":"2026-10-01T00:00:00Z"}'; exit 0; fi
code=0
for ((i = 0; i < \${#args[@]}; i++)); do [ "\${args[i]}" = --exit-code ] && code="\${args[i+1]}"; done
grep -qxF "$source" "$FAKE_FINDINGS" && exit "$code"
exit 0
`;
// curl -o FILE -w '%{http_code}' URL: answers with the status in $FAKE_STATUS/<orgs|users> (default 200) and, on 200,
// the body in $FAKE_STATUS/page<N>.json (default []).
const FAKE_CURL = `#!/bin/bash
args=("$@"); url="\${args[-1]}"; out=""
for ((i = 0; i < \${#args[@]}; i++)); do [ "\${args[i]}" = -o ] && out="\${args[i+1]}"; done
echo "curl $url" >> "$FAKE_CALLS"
kind="\${url#https://api.github.com/}"; kind="\${kind%%/*}"
page="\${url##*page=}"
status=200; [ -e "$FAKE_STATUS/$kind" ] && status="$(cat "$FAKE_STATUS/$kind")"
if [ "$status" = 200 ] && [ -e "$FAKE_STATUS/page$page.json" ]; then cp "$FAKE_STATUS/page$page.json" "$out"; else echo '[]' > "$out"; fi
printf '%s' "$status"
`;

const sha = (n: number) => `sha256:${String(n).repeat(64)}`;
const GHCR = `ghcr.io/example-org/pds:1@${sha(3)}`;
const HUB = `docker.io/library/r1:1@${sha(1)}`;
const HUB2 = `docker.io/library/r2:1@${sha(2)}`;

type Run = { code: number | null; out: string; calls: string[]; dir: string };
type Setup = { pins?: { source: string; stripped: string[] }[]; findings?: string[]; status?: Record<string, string> };

function sandbox(setup: Setup): { dir: string; env: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "pins-job-"));
  const bin = join(dir, "bin");
  const fakes = join(dir, "status");
  mkdirSync(bin);
  mkdirSync(fakes);
  for (const [name, body] of [
    ["git", FAKE_GIT],
    ["docker", FAKE_DOCKER],
    ["curl", FAKE_CURL],
  ] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  for (const [file, body] of Object.entries(setup.status ?? {})) writeFileSync(join(fakes, file), body);
  if (setup.pins !== undefined) writeFileSync(join(dir, "pins.json"), JSON.stringify(setup.pins));
  writeFileSync(join(dir, "findings"), (setup.findings ?? []).map((line) => `${line}\n`).join(""));
  writeFileSync(join(dir, "calls"), "");
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
    RUNNER_TEMP: dir,
    GH_TOKEN: "test-token",
    BASE_SHA: "0".repeat(40),
    TRIVY_IMAGE: "trivy",
    FAKE_CALLS: join(dir, "calls"),
    FAKE_FINDINGS: join(dir, "findings"),
    FAKE_STATUS: fakes,
    FAKE_BASE: join(dir, "base.json"),
  };
  return { dir, env };
}

function runStep(step: Step, dir: string, env: Record<string, string>): Run {
  const ran = spawnSync("bash", [...actionsShell(step.shell), "-c", step.run ?? ""], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  const calls = readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean);
  return { code: ran.status, out: ran.stdout + ran.stderr, calls, dir };
}

const times = named("Print each pin");
const scanStep = named("Scan each pin");
const pin = (source: string) => ({ source, stripped: [] });

describe("pins job", () => {
  test("scan_runs_when_the_ghcr_lookup_fails", () => {
    // The scan is gated on the selection alone, so the job's default success() never skips it after a failed lookup.
    expect(named("Select").id).toBe("select");
    expect(scanStep.if).toBe(`$${"{{"} !cancelled() && steps.select.outcome == 'success' }}`);
    const { dir, env } = sandbox({ pins: [pin(GHCR), pin(HUB)], status: { orgs: "403", users: "403" } });
    const looked = runStep(times, dir, env);
    expect(looked.code, looked.out).toBe(1);
    expect(looked.out).toContain(`::error title=pins::GHCR refused the push-time lookup for ${GHCR} (HTTP 403)`);
    expect(looked.out).toContain("https://github.com/orgs/example-org/packages/container/package/pds");
    // The other pin's times are still printed.
    expect(looked.out).toContain(`${HUB}: image config created 2026-10-01T00:00:00Z`);
    const scanned = runStep(scanStep, dir, env);
    expect(scanned.code, scanned.out).toBe(0);
    expect(scanned.calls).toEqual(expect.arrayContaining([`docker run ${GHCR}`, `docker run ${HUB}`]));
  });

  test("ghcr_lookup_other_failures_are_named", () => {
    for (const status of ["500", "000"]) {
      const { dir, env } = sandbox({ pins: [pin(GHCR)], status: { orgs: status, users: status } });
      const looked = runStep(times, dir, env);
      expect(looked.code, looked.out).toBe(1);
      expect(looked.out).toContain(`::error title=pins::GHCR lookup failed for ${GHCR} (HTTP ${status})`);
    }
  });

  test("ghcr_push_time_is_found_across_pages", () => {
    const filler = Array.from({ length: 100 }, (_, i) => ({ name: `sha256:${String(i).padStart(64, "f")}` }));
    const { dir, env } = sandbox({
      pins: [pin(GHCR)],
      status: {
        orgs: "404",
        "page1.json": JSON.stringify(filler),
        "page2.json": JSON.stringify([{ name: sha(3), created_at: "2026-09-30T12:00:00Z" }]),
      },
    });
    const looked = runStep(times, dir, env);
    expect(looked.code, looked.out).toBe(0);
    expect(looked.out).toContain(`${GHCR}: pushed to GHCR at 2026-09-30T12:00:00Z`);
    // orgs answered 404, so the users listing was read, page by page.
    expect(looked.calls.filter((call) => call.startsWith("curl")).map((call) => call.split("/")[3])).toEqual([
      "orgs",
      "users",
      "users",
    ]);
  });

  test("ghcr_without_the_digest_fails", () => {
    const { dir, env } = sandbox({ pins: [pin(GHCR)], status: { "page1.json": JSON.stringify([{ name: sha(4) }]) } });
    const looked = runStep(times, dir, env);
    expect(looked.code, looked.out).toBe(1);
    expect(looked.out).toContain(`::error title=pins::no GHCR package version has ${sha(3)} (${GHCR})`);
  });

  test("a_docker_hub_pin_makes_no_ghcr_call", () => {
    const { dir, env } = sandbox({ pins: [pin(HUB)] });
    const looked = runStep(times, dir, env);
    expect(looked.code, looked.out).toBe(0);
    expect(looked.out).toContain(`${HUB}: not on ghcr.io, no push time looked up`);
    expect(looked.calls.some((call) => call.startsWith("curl"))).toBe(false);
  });

  test("scan_reports_every_failing_pin", () => {
    const { dir, env } = sandbox({ pins: [pin(HUB), pin(GHCR), pin(HUB2)], findings: [HUB, GHCR] });
    const scanned = runStep(scanStep, dir, env);
    expect(scanned.code, scanned.out).toBe(1);
    expect(scanned.out).toContain(`::error title=pins::scan failed (exit 1) for ${HUB}`);
    expect(scanned.out).toContain(`::error title=pins::scan failed (exit 1) for ${GHCR}`);
    expect(scanned.out).not.toContain(`for ${HUB2}`);
    // A clean pin after two failing ones is still scanned.
    expect(scanned.calls.at(-1)).toBe(`docker run ${HUB2}`);
  });

  test("select_writes_only_the_changed_pins", () => {
    const entry = (n: number) => ({
      ref: `docker.io/library/r${n}`,
      tag: "1",
      digest: sha(n),
      source: "upstream",
      stage: "runtime",
      buildStage: false,
    });
    const { dir, env } = sandbox({});
    writeFileSync(join(dir, "base.json"), JSON.stringify({ a: entry(1) }));
    writeFileSync(join(dir, "head.json"), JSON.stringify({ a: entry(1), b: entry(2) }));
    const selected = runStep(named("Select"), dir, { ...env, BASES_LOCK: join(dir, "head.json") });
    expect(selected.code, selected.out).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "pins.json"), "utf8"))).toEqual([pin(HUB2)]);
    expect(selected.out).toContain(HUB2);
  });
});
