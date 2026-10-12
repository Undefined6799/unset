// P1.27w: the dev stack wrapper (deployment/preflight/stack.ts). Its process runner is the one double; nothing here starts Docker.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { CHILD_ENV_NAMES, childEnv, plan, run, UsageError } from "./stack.ts";

const COMPOSE = ["--compose", "deployment/compose.dev.yaml"];
const ENV_FILE = ["--interpolation-env", "deployment/env/dev.env"];
const UP = ["up", "--env", "dev", ...COMPOSE, ...ENV_FILE];
const DOWN = ["down", "--env", "dev", ...COMPOSE, ...ENV_FILE];

describe("stack wrapper (P1.27w)", () => {
  test("child_env_is_exactly_the_allowlist", () => {
    // Architecture record 2026-10-12-preflight-compose-inputs, F3.3: these six names and nothing else.
    expect(CHILD_ENV_NAMES).toEqual([
      "PATH",
      "HOME",
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_CONFIG",
      "DOCKER_CERT_PATH",
    ]);
    const caller = {
      PATH: "/usr/bin",
      HOME: "/home/dev",
      DOCKER_HOST: "unix:///run/docker.sock",
      WEB_PUBLIC_ORIGIN: "https://elsewhere.example.net",
      NODE_OPTIONS: "--require=/tmp/x.js",
    };
    expect(childEnv(caller)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/dev",
      DOCKER_HOST: "unix:///run/docker.sock",
      NODE_OPTIONS: "",
    });
    expect(plan(UP, caller).env).toEqual(childEnv(caller));
  });

  test("up_runs_the_preflight_then_compose_with_the_same_inputs", () => {
    const files = ["deployment/compose.dev.yaml", "deployment/other.yaml"].map((f) => resolve(f));
    const envFile = resolve("deployment/env/dev.env");
    const { commands } = plan(
      ["up", "--env", "dev", "--compose", files[0] as string, "--compose", files[1] as string, ...ENV_FILE],
      {},
    );
    expect(commands.map((c) => c.file)).toEqual([process.execPath, "docker"]);
    // Amendment 3 of 2026-10-12-preflight-compose-inputs: after "--", so Node never reads an argument as its own flag.
    expect(commands[0]?.args.slice(1)).toEqual([
      "--",
      "--env",
      "dev",
      "--compose",
      files[0],
      "--compose",
      files[1],
      "--interpolation-env",
      envFile,
    ]);
    expect(commands[0]?.args[0]).toMatch(/deployment\/preflight\/index\.ts$/);
    expect(commands[1]?.args).toEqual([
      "compose",
      "-f",
      files[0],
      "-f",
      files[1],
      "--env-file",
      envFile,
      "up",
      "-d",
      "--build",
    ]);
  });

  test("compose_paths_reach_both_children_absolute_and_normalized", () => {
    // C9 record Amendment 3: the preflight refuses a relative or unnormalized --compose, and Compose would resolve one
    // against $PWD while Node uses getcwd, so the wrapper resolves each path once and passes that one string to both.
    const given = "./deployment/../deployment/compose.dev.yaml";
    const { commands } = plan(
      ["up", "--env", "dev", "--compose", given, "--interpolation-env", "a/./b/../dev.env"],
      {},
    );
    const file = resolve("deployment/compose.dev.yaml");
    const envFile = resolve("a/dev.env");
    expect(file.startsWith("/") && !file.includes("/./") && !file.includes("/../")).toBe(true);
    expect(commands[0]?.args).toEqual([
      expect.any(String),
      "--",
      "--env",
      "dev",
      "--compose",
      file,
      "--interpolation-env",
      envFile,
    ]);
    expect(commands[1]?.args.slice(0, 5)).toEqual(["compose", "-f", file, "--env-file", envFile]);
    expect(CHILD_ENV_NAMES).not.toContain("PWD");
  });

  test("a_cwd_entered_through_a_link_gives_both_children_the_physical_path", () => {
    // C9 record addendum: a relative path resolves once against process.cwd(), the physical directory (getcwd), never
    // $PWD, which names the link. process.chdir is unavailable in test workers, so a child process plans from there.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "stack-")));
    try {
      mkdirSync(join(dir, "real"));
      symlinkSync(join(dir, "real"), join(dir, "link"));
      const code = `import { plan } from ${JSON.stringify(join(import.meta.dirname, "stack.ts"))};
        const argv = ["up", "--env", "dev", "--compose", "compose.yaml", "--interpolation-env", "dev.env"];
        process.stdout.write(JSON.stringify(plan(argv, {}).commands.map((c) => c.args)));`;
      const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
        cwd: join(dir, "link"),
        env: { PATH: process.env.PATH ?? "", HOME: dir, PWD: join(dir, "link") },
        encoding: "utf8",
      });
      const [preflight, compose] = JSON.parse(out.stdout) as string[][];
      const file = join(dir, "real", "compose.yaml");
      expect(preflight?.slice(4, 6)).toEqual(["--compose", file]);
      expect(compose?.slice(1, 3)).toEqual(["-f", file]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a_failing_preflight_stops_compose", () => {
    const ran: string[] = [];
    const code = run(plan(UP, {}), (file) => {
      ran.push(file);
      return file === "docker" ? 0 : 1;
    });
    expect(code).toBe(1);
    expect(ran).toEqual([process.execPath]);
    // A child killed by a signal has no status; that stops the run too.
    expect(run(plan(UP, {}), () => null)).toBe(1);
    expect(run(plan(UP, {}), () => 0)).toBe(0);
  });

  test("down_never_removes_volumes", () => {
    const { commands } = plan(DOWN, {});
    expect(commands).toHaveLength(1);
    expect(commands[0]?.args.slice(-1)).toEqual(["down"]);
    expect(commands[0]?.args).not.toContain("-v");
    expect(commands[0]?.args).not.toContain("--volumes");
  });

  test("bad_arguments_are_refused", () => {
    for (const argv of [
      [],
      ["restart", "--env", "dev", ...COMPOSE, ...ENV_FILE],
      ["up", "--env", "prod", ...COMPOSE, ...ENV_FILE],
      ["up", "--env", "dev", ...ENV_FILE],
      ["up", "--env", "dev", ...COMPOSE],
      ["up", "--env", "dev", ...COMPOSE, ...ENV_FILE, ...ENV_FILE],
      ["up", "--env", "dev", ...COMPOSE, ...ENV_FILE, "-v"],
      ["down", "--env", "dev", ...COMPOSE, ...ENV_FILE, "--volumes"],
      ["down", "extra", "--env", "dev", ...COMPOSE, ...ENV_FILE],
      [...UP, "--project-directory", "/tmp"],
      [...UP, "--project-directory=/tmp"],
      // The wrapper's own CLI takes no flag Node would also read (Amendment 3).
      ["up", "--env", "dev", ...COMPOSE, "--env-file", "deployment/env/dev.env"],
    ]) {
      expect(() => plan(argv, {}), argv.join(" ")).toThrow(UsageError);
    }
  });

  test("compose_variables_in_the_caller_env_are_refused", () => {
    // Stack-wrapper ruling: a COMPOSE_* name is refused, not silently dropped, for both actions.
    for (const name of ["COMPOSE_FILE", "COMPOSE_ENV_FILES", "COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES"]) {
      for (const argv of [UP, DOWN]) {
        expect(() => plan(argv, { PATH: "/usr/bin", [name]: "x" }), name).toThrow(new RegExp(`unset ${name}:`));
      }
    }
    // The message names the variables, never their values.
    expect(() => plan(UP, { COMPOSE_FILE: "/secret/path.yaml" })).not.toThrow(/secret/);
    // An unset entry (undefined) is not a set variable.
    expect(plan(UP, { COMPOSE_FILE: undefined }).commands).toHaveLength(2);
  });

  test("node_never_loads_the_interpolation_env_file", () => {
    // Amendment 3 of 2026-10-12-preflight-compose-inputs: Node v26.10.0 scans argv for --env-file up to a literal "--",
    // past the script name, and applies a NODE_OPTIONS line from that file (src/node_dotenv.cc:25-37) unless the real
    // variable is set (src/node.cc:996-998). So the child runs with only PATH and HOME, as the wrapper's own would.
    const dir = mkdtempSync(join(tmpdir(), "stack-"));
    try {
      const script = join(dir, "script.ts");
      writeFileSync(script, "");
      writeFileSync(join(dir, "hook.cjs"), 'process.stdout.write("HOOK");');
      const envFile = join(dir, "dev.env");
      writeFileSync(envFile, `NODE_OPTIONS=--require=${join(dir, "hook.cjs")}\n`);
      const env = { PATH: process.env.PATH ?? "", HOME: dir };
      const runs = (args: string[]) => spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" }).stdout;
      // The fixture bites: the old form, a bare --env-file after the script, runs the hook.
      expect(runs(["--env", "dev", "--env-file", envFile])).toBe("HOOK");
      const preflight = plan(["up", "--env", "dev", ...COMPOSE, "--interpolation-env", envFile], {}).commands[0];
      expect(runs(preflight?.args.slice(1) ?? [])).toBe("");
      // Belt and braces: with the wrapper's own child environment (an empty NODE_OPTIONS), even the old form is inert.
      const childRuns = spawnSync(process.execPath, [script, "--env", "dev", "--env-file", envFile], {
        env: { ...plan(["up", "--env", "dev", ...COMPOSE, "--interpolation-env", envFile], env).env },
        encoding: "utf8",
      }).stdout;
      expect(childRuns).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
