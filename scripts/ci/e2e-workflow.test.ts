// e2e.yml's gate (P0.07b). The browser legs and a11y run in parallel; the `e2e` job holds the required name, so it
// must be red whenever a leg did not succeed. A job whose if has no status function is skipped when a need fails, and
// a skipped required check reads as passing (expressions, "Status check functions"), hence always() and the result
// check, run here as Actions runs a step with no shell key: `bash -e` (workflow syntax, jobs.<job_id>.steps[*].shell).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { E2E_PROJECTS } from "../test/assert-tests-ran.ts";

type Step = {
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  "timeout-minutes"?: number;
};
type Job = {
  needs?: string[];
  if?: string;
  strategy?: { "fail-fast"?: boolean; matrix?: { project?: string[] } };
  steps?: Step[];
};
const ROOT = join(import.meta.dirname, "..", "..");
const wf = parse(readFileSync(join(ROOT, ".github", "workflows", "e2e.yml"), "utf8")) as { jobs: Record<string, Job> };
const DRAFT = "(github.event_name != 'pull_request' || github.event.pull_request.draft == false)";

describe("e2e gate (P0.07b)", () => {
  const gate = wf.jobs.e2e;

  test("e2e_gate_runs_always_and_needs_every_leg", () => {
    expect(gate?.needs).toEqual(["browser", "a11y"]);
    expect(gate?.if).toBe(`always() && ${DRAFT}`);
  });

  test("e2e_gate_fails_unless_every_leg_succeeded", () => {
    const step = gate?.steps?.[0];
    if (step?.run === undefined) throw new Error("no result check");
    expect(step.env).toEqual({
      BROWSER_RESULT: `$${"{{"} needs.browser.result }}`,
      A11Y_RESULT: `$${"{{"} needs.a11y.result }}`,
    });
    const check = (browser: string, a11y: string) =>
      spawnSync("bash", ["-e", "-c", step.run ?? ""], {
        env: { PATH: process.env.PATH, BROWSER_RESULT: browser, A11Y_RESULT: a11y },
        encoding: "utf8",
      }).status;
    expect(check("success", "success")).toBe(0);
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      expect(check(result, "success"), `browser ${result}`).not.toBe(0);
      expect(check("success", result), `a11y ${result}`).not.toBe(0);
    }
  });

  test("e2e_gate_checks_one_report_per_project", () => {
    expect(wf.jobs.browser?.strategy?.["fail-fast"]).toBe(false);
    expect(wf.jobs.browser?.strategy?.matrix?.project).toEqual([...E2E_PROJECTS]);
    const run = (gate?.steps ?? []).map((step) => step.run ?? "").join("\n");
    for (const project of E2E_PROJECTS) {
      expect(run).toContain(`"${project}=$REPORTS/e2e-${project}/tests/e2e/report.json"`);
    }
  });
});

// P0.07f, P0.07g: the browser install hung until the 30-minute job timeout in several runs on 2026-10-22. The job log
// showed the cause: azure.archive.ubuntu.com served `--with-deps` packages at a crawl (one file stalled 2.5 minutes).
// So apt gives up on a stalled connection after 20 s and retries each file 3 times; each attempt is cut at 4 minutes;
// before the second attempt the orphaned apt-get, which kept the dpkg lock and failed the P0.07f retry ("Could not get
// lock /var/lib/dpkg/lock-frontend"), is stopped and dpkg is left consistent. The step is capped at 9 minutes.
describe("browser install (P0.07f, P0.07g)", () => {
  const installs = Object.entries(wf.jobs).flatMap(([id, job]) =>
    (job.steps ?? []).filter((step) => step.run?.includes("playwright install")).map((step) => [id, step] as const),
  );

  // Runs the step as Actions does (`bash -e`) with stand-ins for timeout, npx, sudo and pgrep that log each call;
  // npx fails its first `failures` calls.
  function runInstall(script: string, failures: number): { status: number | null; calls: string[] } {
    const bin = mkdtempSync(join(tmpdir(), "e2e-install-"));
    const log = join(bin, "calls.log");
    const stub = (name: string, body: string) =>
      writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
    stub("timeout", 'shift 2; exec "$@"');
    stub("npx", `n=$(grep -c '^npx ' "${log}"); [ "$n" -gt ${failures} ]`);
    stub("sudo", "cat > /dev/null; exit 0");
    // apt-get is still alive for the first two checks after it is signalled, as it is while it shuts down.
    stub("pgrep", `[ "$(grep -c '^pgrep ' "${log}")" -le 2 ]`);
    stub("sleep", "exit 0");
    const status = spawnSync("bash", ["-e", "-c", script], {
      env: { PATH: `${bin}:${process.env.PATH}`, PROJECT: "webkit" },
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    }).status;
    const calls = readFileSync(log, "utf8").trim().split("\n");
    rmSync(bin, { recursive: true });
    return { status, calls };
  }

  test("every_browser_install_is_bounded_and_retried_once", () => {
    expect(installs.map(([id]) => id)).toEqual(["browser", "a11y"]);
    for (const [id, step] of installs) {
      expect(step["timeout-minutes"], id).toBe(9);
      const run = step.run ?? "";
      expect(run, id).toContain(`Acquire::http::Timeout "20";`);
      expect(run, id).toContain(`Acquire::Retries "3";`);
      expect(run, id).toMatch(/timeout --kill-after=10s 240s npx playwright install --with-deps /);
    }
  });

  test("a_healthy_install_runs_once", () => {
    for (const [id, step] of installs) {
      const { status, calls } = runInstall(step.run ?? "", 0);
      expect(status, id).toBe(0);
      expect(
        calls.filter((call) => call.startsWith("npx ")),
        id,
      ).toHaveLength(1);
      expect(
        calls.some((call) => call.includes("pkill")),
        id,
      ).toBe(false);
    }
  });

  test("a_stalled_install_stops_apt_then_retries_once", () => {
    for (const [id, step] of installs) {
      const { status, calls } = runInstall(step.run ?? "", 1);
      expect(status, id).toBe(0);
      const npx = calls.flatMap((call, i) => (call.startsWith("npx ") ? [i] : []));
      const pkill = calls.indexOf("sudo pkill -KILL -x apt-get");
      const dpkg = calls.indexOf("sudo dpkg --configure -a");
      // Codex on #1287: dpkg is repaired only once the signalled apt-get has gone, or it races apt-get for the lock.
      const lastWait = calls.lastIndexOf("pgrep -x apt-get");
      expect(npx, id).toHaveLength(2);
      expect(pkill, id).toBeGreaterThan(npx[0] ?? Infinity);
      expect(calls.filter((call) => call === "pgrep -x apt-get").length, id).toBe(3);
      expect(lastWait, id).toBeGreaterThan(pkill);
      expect(dpkg, id).toBeGreaterThan(lastWait);
      expect(npx[1], id).toBeGreaterThan(dpkg);
    }
  });

  test("two_failed_installs_fail_the_step", () => {
    for (const [id, step] of installs) {
      const { status, calls } = runInstall(step.run ?? "", 2);
      expect(status, id).not.toBe(0);
      expect(
        calls.filter((call) => call.startsWith("npx ")),
        id,
      ).toHaveLength(2);
    }
  });
});

// P0.07h: both 4-minute attempts were cut while the mirror served about 50 KB/s, so the browser and the packages apt
// fetched for it are cached. apt does not check the hash of a file already in its archive directory (a flipped byte
// reached dpkg on Ubuntu 24.04), so a cached package is handed over only when it matches the signed index.
describe("browser cache (P0.07h)", () => {
  const jobs = ["browser", "a11y"].map((id) => [id, wf.jobs[id]?.steps ?? []] as const);
  const at = (steps: readonly Step[], match: (step: Step) => boolean) => steps.findIndex(match);

  test("each_install_restores_the_cache_before_it_and_keeps_the_packages_after_it", () => {
    for (const [id, steps] of jobs) {
      const restore = at(steps, (step) => step.uses?.startsWith("actions/cache@") === true);
      const handOver = at(steps, (step) => step.run?.includes("apt-cache show") === true);
      const install = at(steps, (step) => step.run?.includes("playwright install") === true);
      const keep = at(steps, (step) => step.run?.includes("/var/cache/apt/archives -maxdepth 1") === true);
      expect(restore, id).toBeGreaterThan(-1);
      expect(handOver, id).toBeGreaterThan(restore);
      expect(install, id).toBeGreaterThan(handOver);
      expect(keep, id).toBeGreaterThan(install);
      const cache = steps[restore];
      expect(cache?.with?.path?.trim().split("\n"), id).toEqual(["~/.cache/ms-playwright", "~/apt-archives"]);
      for (const part of ["runner.os", "steps.cache-name.outputs.image", "steps.cache-name.outputs.playwright"]) {
        expect(cache?.with?.key, id).toContain(part);
      }
      expect(steps[keep]?.if, id).toBe(`steps.${cache?.id}.outputs.cache-hit != 'true'`);
      expect(steps[install]?.run, id).toContain(`APT::Keep-Downloaded-Packages "true";`);
      // Codex on #1292: the index refresh before the hand-over must not wait on a stalled mirror past the step.
      expect(steps[handOver]?.["timeout-minutes"], id).toBe(3);
      expect(steps[handOver]?.run, id).toContain(
        "sudo timeout --kill-after=10s 120s apt-get update -q -o Acquire::http::Timeout=20 -o Acquire::Retries=3",
      );
    }
  });

  // Runs the hand-over as Actions does (`bash -e`) over a cached directory, with stand-ins for sudo, dpkg-deb, apt-cache
  // and sha256sum. A package file holds "NAME VERSION ARCH", and its "hash" is that text with "/" for spaces; the index signs good 1 and 1:2 on
  // amd64. A file whose text starts with "broken" is not an archive.
  function handOver(script: string, debs: Record<string, string>): string[] {
    const root = mkdtempSync(join(tmpdir(), "e2e-apt-"));
    const bin = join(root, "bin");
    const cached = join(root, "home", "apt-archives");
    const archives = join(root, "archives");
    for (const dir of [bin, cached, archives]) mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(debs)) writeFileSync(join(cached, file), text);
    const stub = (name: string, body: string) =>
      writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    stub("sudo", '[ "$1" = cp ] && exec "$@"; exit 0');
    stub(
      "dpkg-deb",
      'read -r n v a rest < "$2"; [ "$n" = broken ] && exit 2; case "$3" in Package) echo "$n";; Version) echo "$v";; Architecture) echo "$a";; esac',
    );
    stub(
      "apt-cache",
      'case "$2" in "good:amd64=1" | "good:amd64=1:2") n=${2%%:*}; v=${2#*=}; echo "SHA256: $n/$v/amd64";; esac; exit 0',
    );
    stub("sha256sum", 'echo "$(tr " " /) -"');
    const status = spawnSync("bash", ["-e", "-c", script.replaceAll("/var/cache/apt/archives/", `${archives}/`)], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: join(root, "home") },
      stdio: "ignore",
    }).status;
    const handed = readdirSync(archives).sort();
    rmSync(root, { recursive: true });
    expect(status).toBe(0);
    return handed;
  }

  test("only_packages_matching_the_index_reach_apt", () => {
    for (const [id, steps] of jobs) {
      const script = steps.find((step) => step.run?.includes("apt-cache show"))?.run ?? "";
      const handed = handOver(script, {
        "good_1_amd64.deb": "good 1 amd64",
        "good_3_amd64.deb": "good 3 amd64",
        "other_1_amd64.deb": "other 1 amd64",
        "broken_1_all.deb": "broken 1 all",
      });
      expect(handed, id).toEqual(["good_1_amd64.deb"]);
      expect(handOver(script, { "good_1_amd64.deb": "good 1 amd64 tampered" }), id).toEqual([]);
      expect(handOver(script, {}), id).toEqual([]);
    }
  });

  // Verify of #1292: a signed package cached under another package's name lands under its own name, and an epoch's
  // ":" is written "%3a" as apt writes it.
  test("a_verified_package_is_handed_over_under_its_own_name", () => {
    for (const [id, steps] of jobs) {
      const script = steps.find((step) => step.run?.includes("apt-cache show"))?.run ?? "";
      expect(handOver(script, { "libnss3_9_amd64.deb": "good 1 amd64" }), id).toEqual(["good_1_amd64.deb"]);
      expect(handOver(script, { "good_1%3a2_amd64.deb": "good 1:2 amd64" }), id).toEqual(["good_1%3a2_amd64.deb"]);
    }
  });
});
