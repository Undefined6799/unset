// e2e.yml's gate (P0.07b). The browser legs and a11y run in parallel; the `e2e` job holds the required name, so it
// must be red whenever a leg did not succeed. A job whose if has no status function is skipped when a need fails, and
// a skipped required check reads as passing (expressions, "Status check functions"), hence always() and the result
// check, run here as Actions runs a step with no shell key: `bash -e` (workflow syntax, jobs.<job_id>.steps[*].shell).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  env?: Record<string, string>;
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
    // P0.07n: only a11y still installs a browser on the runner; the browser jobs use Playwright's image.
    expect(installs.map(([id]) => id)).toEqual(["a11y"]);
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
  const jobs = ["a11y"].map((id) => [id, wf.jobs[id]?.steps ?? []] as const);
  const at = (steps: readonly Step[], match: (step: Step) => boolean) => steps.findIndex(match);

  test("each_install_restores_the_cache_before_it_and_keeps_the_packages_after_it", () => {
    for (const [id, steps] of jobs) {
      const browser = at(steps, (step) => step.uses?.startsWith("actions/cache@") === true);
      const restore = at(steps, (step) => step.uses?.startsWith("actions/cache/restore@") === true);
      const handOver = at(steps, (step) => step.run?.includes("apt-cache show") === true);
      const install = at(steps, (step) => step.run?.includes("playwright install") === true);
      const keep = at(steps, (step) => step.run?.includes("/var/cache/apt/archives -maxdepth 1") === true);
      const save = at(steps, (step) => step.uses?.startsWith("actions/cache/save@") === true);
      expect(browser, id).toBeGreaterThan(-1);
      expect(restore, id).toBeGreaterThan(-1);
      expect(handOver, id).toBeGreaterThan(Math.max(browser, restore));
      expect(install, id).toBeGreaterThan(handOver);
      expect(keep, id).toBeGreaterThan(install);
      expect(save, id).toBe(keep + 1);
      // P0.07m: no runner image in either key, so a runner on another image still finds them.
      expect(steps[browser]?.with?.path, id).toBe("~/.cache/ms-playwright");
      for (const part of ["runner.os", "steps.cache-name.outputs.playwright"]) {
        expect(steps[browser]?.with?.key, id).toContain(part);
      }
      const apt = steps[restore];
      expect(apt?.with?.path, id).toBe("~/apt-archives");
      expect(apt?.with?.key, id).toMatch(/^e2e-apt-\$\{\{ runner\.os \}\}-.+-$/);
      for (const step of [steps[browser], apt]) expect(step?.with?.key, id).not.toContain("image");
      // A failed install still keeps what apt fetched; a cancelled run does not.
      expect(steps[keep]?.if, id).toBe(`$${"{{"} !cancelled() }}`);
      expect(steps[keep]?.env?.PREFIX, id).toBe(`$${"{{"} steps.${apt?.id}.outputs.cache-primary-key }}`);
      expect(steps[save]?.with?.key, id).toBe(`$${"{{"} steps.${steps[keep]?.id}.outputs.key }}`);
      expect(steps[save]?.if, id).toContain("!cancelled()");
      expect(steps[save]?.if, id).toContain(`steps.${apt?.id}.outputs.cache-matched-key`);
      expect(steps[install]?.run, id).toContain(`APT::Keep-Downloaded-Packages "true";`);
      // Codex on #1292: the index refresh before the hand-over must not wait on a stalled mirror past the step.
      expect(steps[handOver]?.["timeout-minutes"], id).toBe(3);
      expect(steps[handOver]?.run, id).toContain(
        "sudo timeout --kill-after=10s 120s apt-get update -q -o Acquire::http::Timeout=20 -o Acquire::Retries=3",
      );
    }
  });

  // Runs the keep step as Actions does (`bash -e`) over a kept directory and apt's archive directory, and returns the
  // kept files and the key it wrote.
  function keep(script: string, kept: Record<string, string>, archives: Record<string, string>, prefix = "p-") {
    const root = mkdtempSync(join(tmpdir(), "e2e-keep-"));
    const home = join(root, "home");
    const apt = join(root, "archives");
    const output = join(root, "output");
    for (const [dir, files] of [
      [join(home, "apt-archives"), kept],
      [apt, archives],
    ] as const) {
      mkdirSync(dir, { recursive: true });
      for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    }
    writeFileSync(output, "");
    const status = spawnSync("bash", ["-e", "-c", script.replaceAll("/var/cache/apt/archives", apt)], {
      env: { PATH: process.env.PATH, HOME: home, PREFIX: prefix, GITHUB_OUTPUT: output },
      stdio: "ignore",
    }).status;
    const files = readdirSync(join(home, "apt-archives")).sort();
    const key = readFileSync(output, "utf8").trim();
    rmSync(root, { recursive: true });
    expect(status).toBe(0);
    return { files, key };
  }

  test("the_kept_set_gains_new_packages_and_drops_replaced_versions", () => {
    for (const [id, steps] of jobs) {
      const script = steps.find((step) => step.run?.includes("/var/cache/apt/archives -maxdepth 1"))?.run ?? "";
      const first = keep(script, { "a_1_amd64.deb": "a1", "b_1_all.deb": "b1" }, { "a_2_amd64.deb": "a2" });
      expect(first.files, id).toEqual(["a_2_amd64.deb", "b_1_all.deb"]);
      expect(first.key, id).toMatch(/^key=p-[0-9a-f]{16}$/);
      // The same set gives the same key, so it is not saved twice; different contents give another.
      const again = keep(script, { "b_1_all.deb": "b1" }, { "a_2_amd64.deb": "a2" });
      expect(again.key, id).toBe(first.key);
      expect(keep(script, { "b_1_all.deb": "b1" }, { "a_2_amd64.deb": "a3" }).key, id).not.toBe(first.key);
      // A failed install that fetched nothing keeps the restored set as it was.
      expect(keep(script, { "b_1_all.deb": "b1" }, {}).files, id).toEqual(["b_1_all.deb"]);
      // Nothing to keep, or a cache service that never answered: no key, so no save.
      expect(keep(script, {}, {}).key, id).toBe("");
      expect(keep(script, { "b_1_all.deb": "b1" }, {}, "").key, id).toBe("");
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

// P0.07n: the apt mirror served 20 to 60 kB/s on 2026-11-18 and the browser jobs timed out installing system packages
// before any test ran, cache or not. The browser jobs now take the browsers and their libraries prebuilt from
// Playwright's own image (playwright.dev/docs/docker, "Remote Connection"), run its server from the lockfile's
// playwright-core, and connect the tests to it through PW_TEST_CONNECT_WS_ENDPOINT
// (node_modules/playwright/lib/index.js connectOptionsFromEnv, 1.64.1).
describe("browser server image (P0.07n)", () => {
  const job = wf.jobs.browser;
  const steps = job?.steps ?? [];
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  const playwright = lock.packages["node_modules/playwright-core"]?.version;

  test("the_image_is_playwrights_own_at_the_lockfile_version_pinned_by_digest", () => {
    const image = job?.env?.PLAYWRIGHT_IMAGE ?? "";
    expect(playwright).toMatch(/^\d+\.\d+\.\d+$/);
    expect(image).toMatch(new RegExp(`^mcr\\.microsoft\\.com/playwright:v${playwright}-noble@sha256:[0-9a-f]{64}$`));
  });

  test("the_browser_jobs_install_nothing_on_the_runner", () => {
    const run = steps.map((step) => step.run ?? "").join("\n");
    expect(run).not.toMatch(/apt-get|playwright install|dpkg/);
    expect(steps.some((step) => step.uses?.startsWith("actions/cache"))).toBe(false);
  });

  test("the_server_runs_the_lockfiles_playwright_core_and_the_tests_connect_to_it", () => {
    const start = steps.find((step) => step.run?.includes("run-server"));
    const tests = steps.find((step) => step.run?.includes("npx playwright test"));
    if (start?.run === undefined || tests?.run === undefined) throw new Error("no server or test step");
    expect(steps.indexOf(start)).toBeLessThan(steps.indexOf(tests));
    // No npx download inside the image: the server is node_modules/playwright-core, mounted read-only.
    expect(start.run).toContain(
      '--volume "$PWD/node_modules:/opt/pw/node_modules:ro" "$PLAYWRIGHT_IMAGE" node /opt/pw/node_modules/playwright-core/cli.js run-server',
    );
    expect(start.run).not.toContain("npx");
    expect(start.run).toContain("--user pwuser");
    expect(start.run).toContain("--host 127.0.0.1");
    expect(tests.run).toContain('PW_TEST_CONNECT_WS_ENDPOINT="ws://127.0.0.1:$BROWSER_PORT/" npx playwright test');
  });

  // Nobody re-runs a failed job by hand (agents cannot): a pull that fails or stalls is tried again in the job, up to
  // three times, before the server starts. docker keeps the layers a cut attempt finished, so each retry resumes.
  test("the_image_pull_retries_in_the_job_up_to_three_times", () => {
    const pull = steps.find((step) => step.run?.includes("docker pull"));
    const start = steps.find((step) => step.run?.includes("run-server"));
    if (pull?.run === undefined || start === undefined) throw new Error("no pull or start step");
    expect(steps.indexOf(pull)).toBeLessThan(steps.indexOf(start));
    expect(pull["timeout-minutes"]).toBeGreaterThanOrEqual(16);
    const bin = mkdtempSync(join(tmpdir(), "e2e-pull-"));
    const log = join(bin, "calls");
    const fake = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    fake("sleep", "exit 0");
    const run = (failures: number) => {
      writeFileSync(log, "");
      fake("docker", `echo x >> "${log}"; [ "$(wc -l < "${log}")" -gt ${failures} ]`);
      const status = spawnSync("bash", ["-e", "-c", pull.run ?? ""], {
        env: { PATH: `${bin}:${process.env.PATH}`, PLAYWRIGHT_IMAGE: "img" },
        stdio: "ignore",
      }).status;
      return { status, calls: readFileSync(log, "utf8").split("\n").filter(Boolean).length };
    };
    expect(run(0)).toEqual({ status: 0, calls: 1 });
    expect(run(2)).toEqual({ status: 0, calls: 3 });
    expect(run(3)).toEqual({ status: 1, calls: 3 });
  });

  // The start step's first line refuses an image whose tag names another Playwright version than node_modules.
  test("a_version_mismatch_stops_the_job", () => {
    const start = steps.find((step) => step.run?.includes("run-server"))?.run ?? "";
    const check = start.split("\n")[0] ?? "";
    const run = (image: string) =>
      spawnSync("bash", ["-e", "-c", check], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, PLAYWRIGHT_IMAGE: image },
        stdio: "ignore",
      }).status;
    expect(run(`mcr.microsoft.com/playwright:v${playwright}-noble@sha256:${"a".repeat(64)}`)).toBe(0);
    expect(run(`mcr.microsoft.com/playwright:v1.0.0-noble@sha256:${"a".repeat(64)}`)).not.toBe(0);
    expect(run("")).not.toBe(0);
  });
});

// P6.02: the chat specs skip without CHAT_E2E_*, and assert-tests-ran refuses a skip with no allowance, so the chromium
// leg starts a real Synapse and MAS (tests/e2e/fixtures/chat-servers-up.ts) and exports the variables it writes before
// Playwright runs. The step runs here as Actions runs it (`bash -e`) with stand-ins for node and npx.
describe("chat servers (P6.02)", () => {
  const step = (wf.jobs.browser?.steps ?? []).find((s) => s.run?.includes("npx playwright test"));
  const VARS = ["SYNAPSE_URL", "MAS_URL", "MAS_ADMIN_URL", "MAS_CLIENT_ID", "MAS_CLIENT_SECRET_FILE"].map(
    (name) => `CHAT_E2E_${name}`,
  );

  function runStep(project: string, starter: "ready" | "fails") {
    const root = mkdtempSync(join(tmpdir(), "e2e-chat-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const log = join(root, "calls");
    writeFileSync(log, "");
    const env = VARS.map((name) => `${name}=v-${name}`).join("\\n");
    const stub = (name: string, body: string) =>
      writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    stub(
      "node",
      [
        `echo "node $*" >> "${log}"`,
        'case "$1" in',
        `  *chat-servers-up.ts) [ "${starter}" = ready ] || exit 1; printf '${env}\\n' > "$2"; exec sleep 30 ;;`,
        '  *servers.ts) [ "$2" = wait ] && exit 0; exec sleep 30 ;;',
        "esac",
      ].join("\n"),
    );
    stub("npx", `env | grep '^CHAT_E2E_' | sort >> "${log}"; echo "npx $*" >> "${log}"`);
    const status = spawnSync("bash", ["-e", "-c", step?.run ?? ""], {
      cwd: root,
      env: { PATH: `${bin}:${process.env.PATH}`, PROJECT: project, RUNNER_TEMP: root, BROWSER_PORT: "1" },
      stdio: "ignore",
      timeout: 30_000,
    }).status;
    const calls = readFileSync(log, "utf8").trim().split("\n");
    rmSync(root, { recursive: true });
    return { status, calls };
  }

  test("chromium_starts_the_chat_servers_and_playwright_sees_every_variable", () => {
    const { status, calls } = runStep("chromium", "ready");
    expect(status).toBe(0);
    expect(calls.some((call) => /^node tests\/e2e\/fixtures\/chat-servers-up\.ts .+chat-e2e\.env$/.test(call))).toBe(
      true,
    );
    const npx = calls.findIndex((call) => call.startsWith("npx playwright test"));
    expect(calls.slice(0, npx).filter((call) => call.startsWith("CHAT_E2E_"))).toEqual(
      [...VARS].sort().map((name) => `${name}=v-${name}`),
    );
  }, 40_000);

  test("a_chat_server_start_that_fails_stops_the_leg_before_playwright", () => {
    const { status, calls } = runStep("chromium", "fails");
    expect(status).not.toBe(0);
    expect(calls.some((call) => call.startsWith("npx "))).toBe(false);
  }, 40_000);

  test("the_other_browsers_start_no_chat_servers", () => {
    for (const project of ["firefox", "webkit"]) {
      const { status, calls } = runStep(project, "ready");
      expect(status, project).toBe(0);
      expect(
        calls.some((call) => call.includes("chat-servers-up")),
        project,
      ).toBe(false);
      expect(
        calls.some((call) => call.startsWith("CHAT_E2E_")),
        project,
      ).toBe(false);
    }
  }, 40_000);

  test("the_chat_servers_log_is_kept", () => {
    const upload = (wf.jobs.browser?.steps ?? []).find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with?.path).toContain("e2e-chat-servers.log");
  });
});
