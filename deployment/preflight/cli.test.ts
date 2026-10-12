// The preflight as a real process (ruling 2026-10-12-preflight-compose-inputs, Amendments 3 and 4). Node v26.10.0
// reads `--env-file` anywhere in argv up to a literal `--`, even after the script name, and applies the file's
// NODE_OPTIONS before any of our code runs (src/node_dotenv.cc:21-66, src/node.cc:982-1003). So the env file the
// preflight judges must never reach it under that name. Each run gets only PATH and HOME: a real NODE_OPTIONS, even an
// empty one, wins over the file's (node.cc:996-998) and would hide the hole.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { CLI_OPTIONS, preflight } from "./index.ts";

const CLI = join(import.meta.dirname, "index.ts");
// One run reads two small files and exits before any check; 20 s kills a hung one inside the test's 30 s.
const RUN_MS = 20_000;
const TEST_MS = 30_000;
const dir = mkdtempSync(join(tmpdir(), "preflight-cli-"));
const compose = join(dir, "compose.yaml");
writeFileSync(compose, "name: unset-prod\nservices:\n  pds:\n    image: x\n");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function envFile(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  chmodSync(path, 0o600);
  return path;
}

/** The CLI with `args`, with and without the `--` belt, in an environment of only PATH and HOME. */
function cli(args: readonly string[], belt: boolean): { code: number | null; out: string } {
  const ran = spawnSync(process.execPath, [CLI, ...(belt ? ["--"] : []), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir },
    timeout: RUN_MS,
    killSignal: "SIGKILL",
  });
  return { code: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

describe("preflight CLI", () => {
  test("env_file_cannot_run_code_in_the_preflight", { timeout: TEST_MS }, () => {
    // The verifier's line on #677: run as `--env-file`, Node imported it and the process exited 0.
    const file = envFile(
      "deploy.env",
      "NODE_OPTIONS=--import=data:text/javascript,process.exit(0)\nCOMPOSE_PROJECT_NAME=evil\n",
    );
    for (const belt of [false, true]) {
      const ran = cli(["--env", "prod", "--compose", compose, "--interpolation-env", file], belt);
      expect(ran, `belt ${belt}`).toEqual({ code: 2, out: "ERROR NODE_OPTIONS is set in the env file\n" });
    }
  });

  test("interpolation_env_refusals_reach_the_cli", { timeout: TEST_MS }, () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    for (const path of ["~/deploy.env", "$HOME/deploy.env", "/srv/${STAGE}.env"]) {
      const ran = cli(["--env", "prod", "--compose", compose, "--interpolation-env", path], false);
      expect(ran, path).toEqual({ code: 2, out: "ERROR --interpolation-env: a leading ~ or a $ is refused\n" });
    }
    const missing = cli(["--env", "prod", "--compose", compose, "--interpolation-env", join(dir, "absent.env")], false);
    expect(missing.code).toBe(2);
    expect(missing.out).toMatch(/^ERROR cannot read .*absent\.env\n$/);
  });

  test("cli_flags_are_not_ones_node_reads", () => {
    // Node scans the `--env-file` family after the script name; `--require` and `--import` are banned as well.
    const names = Object.keys(CLI_OPTIONS);
    expect(names).toEqual(["env", "compose", "interpolation-env"]);
    for (const name of names) expect(name, name).not.toMatch(/^(env-file|require|import)/);
  });

  test("one_leading_double_dash_is_stripped", async () => {
    const deps = { root: dir, run: async () => ({ code: 0, stdout: "", stderr: "" }), environment: {}, checks: [] };
    const args = ["--env", "prod", "--compose", compose];
    expect(await preflight(args, deps)).toEqual(await preflight(["--", ...args], deps));
    const usage = { code: 2, lines: [expect.stringMatching(/^ERROR usage: /)] };
    expect(await preflight(["--", "--", ...args], deps)).toEqual(usage);
    expect(await preflight([...args, "--"], deps)).toEqual(usage);
    expect(await preflight([...args, "--env-file", join(dir, "deploy.env")], deps)).toEqual(usage);
  });
});
