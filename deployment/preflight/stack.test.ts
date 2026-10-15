// P1.27w: the dev stack wrapper (deployment/preflight/stack.ts). Its process runner is the one double; nothing here starts Docker.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, type Stats, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_DOCKER_HOST, localDockerHost, type WalkInputs } from "../../shared/host-pin/index.ts";
import { CHILD_ENV as READER_CHILD_ENV } from "../../tests/support/pds-email-token.ts";
import {
  CHILD_ENV_NAMES,
  childEnv,
  DOCKER_INFO_DEADLINE_MS,
  type Exit,
  main,
  plan as planStack,
  processRunner,
  type Runner,
  run,
  StackError,
  UsageError,
  WRAPPER_OPTIONS,
} from "./stack.ts";

/** One entry of the fake host's file system: what lstat reports for it, and a link's target. */
type Entry = { kind: "dir" | "file" | "link" | "socket"; uid?: number; mode?: number; nlink?: number; target?: string };
const DEPLOY_UID = 4242;
/** A host file system for the socket walk (P1.34s): only the listed paths exist; /proc is procfs. */
function fakeHost(entries: Readonly<Record<string, Entry>>): WalkInputs {
  const stats = ({ kind, uid = 0, mode = 0o755, nlink = 1 }: Entry) =>
    ({
      uid,
      mode,
      nlink,
      isDirectory: () => kind === "dir",
      isFile: () => kind === "file",
      isSymbolicLink: () => kind === "link",
      isSocket: () => kind === "socket",
    }) as unknown as Stats;
  return {
    lstat: (path) => (entries[path] === undefined ? null : stats(entries[path])),
    readlink: (path) => {
      const target = entries[path]?.target;
      if (target === undefined) throw new Error("not a link");
      return target;
    },
    statfs: (path) => ({ type: path === "/proc" || path.startsWith("/proc/") ? 0x9fa0 : 0xef53 }),
    uid: DEPLOY_UID,
  };
}
const DIR: Entry = { kind: "dir" };
const SOCK: Entry = { kind: "socket", mode: 0o660 };
// A Debian host: /var/run links to /run (as root), the root daemon's socket, a rootless daemon's under the deploy user.
// The fake's lstat does not follow a link part way, so a path through /var/run is listed where it lands as well.
const HOST: Record<string, Entry> = {
  "/": DIR,
  "/var": DIR,
  "/var/run": { kind: "link", target: "/run" },
  "/var/run/docker.sock": SOCK,
  "/run": DIR,
  "/run/docker.sock": SOCK,
  "/run/user": DIR,
  [`/run/user/${DEPLOY_UID}`]: { kind: "dir", uid: DEPLOY_UID, mode: 0o700 },
  [`/run/user/${DEPLOY_UID}/docker.sock`]: { ...SOCK, uid: DEPLOY_UID },
};

// The wrapper's file-system and process doubles: the host above, and a daemon that names this host.
const SOCKET = fakeHost(HOST);
const plan = (argv: string[], from: Readonly<Record<string, string | undefined>>) => planStack(argv, from, SOCKET);
const MACHINE = "devbox";
const runner = (
  spawn: (file: string) => number | null,
  daemon = `Debian GNU/Linux 13 (trixie)|${MACHINE}`,
): Runner => ({
  spawn: (file) => ({ status: spawn(file), signal: null }),
  capture: () => ({ status: 0, signal: null, stdout: `${daemon}\n` }),
  hostname: MACHINE,
});

const COMPOSE = ["--compose", "deployment/compose.dev.yaml"];
const ENV_FILE = ["--interpolation-env", "deployment/env/dev.env"];
const UP = ["up", "--env", "dev", ...COMPOSE, ...ENV_FILE];
const DOWN = ["down", "--env", "dev", ...COMPOSE, ...ENV_FILE];
const LOCAL_COMPOSE = ["--compose", "deployment/compose.local.yaml"];
const LOCAL_UP = ["up", "--env", "local", ...LOCAL_COMPOSE, ...ENV_FILE];
const LOCAL_DOWN = ["down", "--env", "local", ...LOCAL_COMPOSE, ...ENV_FILE];

describe("stack wrapper (P1.27w)", () => {
  test("child_env_is_exactly_the_allowlist", () => {
    // Architecture records 2026-10-12-preflight-compose-inputs, F3.3, and 2026-10-12-workspace-imports-and-remote-daemon
    // (2): these names and nothing else; DOCKER_HOST is always set by the wrapper, and DOCKER_CONTEXT never passes.
    expect(CHILD_ENV_NAMES).toEqual(["PATH", "HOME", "DOCKER_CONFIG", "DOCKER_CERT_PATH"]);
    // The email-token reader keeps the same list as its own copy (P1.33l, N7; book edit 2026-10-13-host-pin-steps,
    // Departure 2): one rule, held equal here.
    expect(READER_CHILD_ENV).toEqual(CHILD_ENV_NAMES);
    const caller = {
      PATH: "/usr/bin",
      HOME: "/home/dev",
      DOCKER_HOST: "unix:///run/docker.sock",
      DOCKER_CONTEXT: "remote",
      WEB_PUBLIC_ORIGIN: "https://elsewhere.example.net",
      NODE_OPTIONS: "--require=/tmp/x.js",
    };
    expect(childEnv(caller, SOCKET)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/dev",
      DOCKER_HOST: "unix:///run/docker.sock",
      NODE_OPTIONS: "",
    });
    expect(plan(UP, caller).env).toEqual(childEnv(caller, SOCKET));
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
        const dir = { isDirectory: () => true, isSymbolicLink: () => false, isSocket: () => false, uid: 0, mode: 0o755 };
        const host = { lstat: (p) => p.endsWith(".sock") ? { ...dir, isDirectory: () => false, isSocket: () => true, nlink: 1 } : dir,
          readlink: () => "", statfs: () => ({ type: 0 }), uid: 0 };
        process.stdout.write(JSON.stringify(plan(argv, {}, host).commands.map((c) => c.args)));`;
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
    const code = run(
      plan(UP, {}),
      runner((file) => {
        ran.push(file);
        return file === "docker" ? 0 : 1;
      }),
    );
    expect(code).toBe(1);
    expect(ran).toEqual([process.execPath]);
    // A child that ends with neither a status nor a signal stops the run too.
    expect(
      run(
        plan(UP, {}),
        runner(() => null),
      ),
    ).toBe(1);
    expect(
      run(
        plan(UP, {}),
        runner(() => 0),
      ),
    ).toBe(0);
  });

  test("local_up_checks_the_served_leaf_after_compose", () => {
    // P1.34d item 15: under local, the served-leaf check runs last, as a process like the preflight.
    const { commands } = plan(LOCAL_UP, {});
    expect(commands.map((c) => c.file)).toEqual([process.execPath, "docker", process.execPath]);
    expect(commands[0]?.args.slice(1, 4)).toEqual(["--", "--env", "local"]);
    expect(commands[2]?.args).toEqual([expect.stringMatching(/deployment\/preflight\/served-leaf\.ts$/)]);
    expect(plan(LOCAL_DOWN, {}).commands.map((c) => c.args.at(-1))).toEqual(["down"]);
  });

  test("a_failing_leaf_check_takes_the_stack_down", () => {
    // P1.34d item 15, red test: a served leaf that differs from the copy brings the stack down, and the run fails.
    const leafCheck = (exit: Exit) => {
      const ran: string[][] = [];
      const leafRunner: Runner = {
        ...runner(() => 0),
        spawn: (file, args) => {
          ran.push([file, ...args.slice(-1)]);
          return /served-leaf\.ts$/.test(args[0] ?? "") ? exit : { status: 0, signal: null };
        },
      };
      return { code: main(LOCAL_UP, {}, leafRunner, () => undefined, SOCKET), ran };
    };
    const failed = leafCheck({ status: 1, signal: null });
    expect(failed.code).toBe(1);
    expect(failed.ran.map((command) => command.at(-1))).toEqual([
      expect.stringMatching(/\.env$/),
      "--build",
      expect.stringMatching(/served-leaf\.ts$/),
      "down",
    ]);
    // A check that is killed or cannot start takes the stack down too.
    const killed = leafCheck({ status: null, signal: "SIGKILL" });
    expect(killed.code).toBe(2);
    expect(killed.ran.at(-1)).toEqual(["docker", "down"]);
    expect(leafCheck({ status: 0, signal: null }).ran.map((command) => command.at(-1))).not.toContain("down");
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
      // An unknown flag; the_wrapper_takes_no_flag_node_also_reads covers the flags Node reads.
      [...UP, "--force-recreate"],
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

  test("only_a_docker_socket_on_this_machine_is_accepted", () => {
    // Record 2026-10-12-workspace-imports-and-remote-daemon (2): C9, C18 and C26 walk this machine's files, and binds
    // resolve on the daemon's, so a remote daemon is refused rather than checked against the wrong files.
    for (const host of [
      "tcp://192.0.2.10:2376",
      "ssh://deploy@192.0.2.10",
      "npipe:////./pipe/docker_engine",
      "unix://run/docker.sock",
      "fd://",
      "",
    ]) {
      expect(() => localDockerHost({ DOCKER_HOST: host }, SOCKET), host).toThrow(
        new UsageError("DOCKER_HOST must be a Docker socket on this machine"),
      );
      expect(() => planStack(UP, { DOCKER_HOST: host }, SOCKET), host).toThrow(UsageError);
    }
    // A unix path that is not a socket (a plain file, a missing path) is refused the same way.
    expect(() => localDockerHost({ DOCKER_HOST: "unix:///run/not-a-socket" }, SOCKET)).toThrow(UsageError);
    // Unset means the local root daemon, and a rootless socket is accepted; both children get the value set.
    expect(plan(UP, {}).env.DOCKER_HOST).toBe(DEFAULT_DOCKER_HOST);
    expect(plan(DOWN, { DOCKER_HOST: `unix:///run/user/${DEPLOY_UID}/docker.sock` }).env.DOCKER_HOST).toBe(
      `unix:///run/user/${DEPLOY_UID}/docker.sock`,
    );
    // By default the walk reads this machine: a temporary folder is sticky or the test user's, and a file is no socket.
    const dir = mkdtempSync(join(tmpdir(), "stack-"));
    try {
      writeFileSync(join(dir, "docker.sock"), "");
      expect(() => planStack(UP, { DOCKER_HOST: `unix://${join(dir, "docker.sock")}` })).toThrow(UsageError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a_daemon_on_another_machine_is_refused", () => {
    const ran: string[] = [];
    const record = (file: string): number => {
      ran.push(file);
      return 0;
    };
    for (const argv of [UP, DOWN]) {
      expect(() => run(plan(argv, {}), runner(record, "Debian GNU/Linux 13 (trixie)|elsewhere"))).toThrow(
        new UsageError("the Docker daemon is not on this machine"),
      );
    }
    expect(ran).toEqual([]);
    // A daemon that does not answer stops the run before anything starts.
    expect(run(plan(UP, {}), { ...runner(record), capture: () => ({ status: 1, signal: null, stdout: "" }) })).toBe(1);
    expect(ran).toEqual([]);
    // The question goes through the children's own environment.
    let asked: Record<string, string> = {};
    run(plan(UP, { DOCKER_HOST: `unix:///run/user/${DEPLOY_UID}/docker.sock` }), {
      ...runner(record),
      capture: (_file, _args, env) => {
        asked = env;
        return { status: 0, signal: null, stdout: `x|${MACHINE}` };
      },
    });
    expect(asked.DOCKER_HOST).toBe(`unix:///run/user/${DEPLOY_UID}/docker.sock`);
  });

  test.runIf(spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0 || process.env.CI)(
    "a_stored_remote_context_never_reaches_the_children",
    () => {
      // Docker CLI 29.8.2: an explicit DOCKER_HOST overrides config.json's currentContext. Without it this config fails
      // ("context \"remote\": context not found"); with the wrapper's environment the CLI uses the given socket.
      const dir = mkdtempSync(join(tmpdir(), "stack-"));
      try {
        writeFileSync(join(dir, "config.json"), JSON.stringify({ currentContext: "remote" }));
        const caller = { PATH: process.env.PATH ?? "", HOME: dir, DOCKER_CONFIG: dir, DOCKER_CONTEXT: "remote" };
        const bare = spawnSync("docker", ["context", "show"], { env: { ...caller }, encoding: "utf8" });
        expect(bare.stdout.trim()).toBe("remote");
        const env = planStack(UP, caller).env;
        expect(env.DOCKER_CONTEXT).toBeUndefined();
        const shown = spawnSync("docker", ["context", "show"], { env, encoding: "utf8" });
        expect(shown.stdout.trim()).toBe("default");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test("a_leading_double_dash_is_the_documented_call", () => {
    // Pitfall note node-reads-env-file-after-script and compose-inputs Amendment 3: callers write `node <script> -- <args>`,
    // so the wrapper strips one leading `--`, as the preflight does (index.ts), and refuses a second.
    expect(plan(["--", ...UP], {})).toEqual(plan(UP, {}));
    expect(plan(["--", ...DOWN], {})).toEqual(plan(DOWN, {}));
    expect(() => plan(["--", "--", ...UP], {})).toThrow(UsageError);
    expect(() => plan([...UP, "--"], {})).toThrow(UsageError);
  });

  test("the_wrapper_takes_no_flag_node_also_reads", () => {
    // Amendment 3 item 2: no --env-file*, --require* or --import*, so a caller's `node stack.ts …` never hands Node one.
    // The accepted flags are listed, and none starts with a banned prefix (P1.34s, nit 1, as cli.test.ts does).
    const names = Object.keys(WRAPPER_OPTIONS);
    expect(names).toEqual(["env", "compose", "interpolation-env"]);
    for (const name of names) expect(name, name).not.toMatch(/^(env-file|require|import)/);
    // Each is added to an otherwise valid command, so only the flag itself can be why it is refused.
    for (const flag of [
      ["--env-file-dir", "x"],
      ["--import-map", "x.json"],
      ["--require-module", "x.cjs"],
      ["--env-file", "x.env"],
      ["--env-file=x.env"],
      ["--env-file-if-exists", "x.env"],
      ["--require", "x.cjs"],
      ["-r", "x.cjs"],
      ["--import", "x.mjs"],
      ["--experimental-loader", "x.mjs"],
    ]) {
      expect(() => plan([...UP, ...flag], {}), flag.join(" ")).toThrow(/^usage: /);
    }
  });

  test("a_child_that_cannot_start_or_is_killed_names_why", () => {
    // DC-4: spawnSync reports a missing program as .error and a kill as .signal, with status null; neither is silent.
    const missing: Runner = {
      ...runner(() => 0),
      spawn: () => ({ status: null, signal: null, error: new Error("ENOENT") }),
    };
    // A reason names the program by a fixed label, never a path (P1.34s, nit 4).
    expect(() => run(plan(UP, {}), missing)).toThrow(new StackError("the preflight could not be started"));
    const killed: Runner = { ...runner(() => 0), spawn: () => ({ status: null, signal: "SIGKILL" }) };
    expect(() => run(plan(DOWN, {}), killed)).toThrow(new StackError("docker was stopped by SIGKILL"));
    const noDocker: Runner = {
      ...runner(() => 0),
      capture: () => ({ status: null, signal: null, stdout: "", error: new Error("ENOENT") }),
    };
    expect(() => run(plan(UP, {}), noDocker)).toThrow(new StackError("docker could not be started"));
  });

  test("docker_info_has_a_deadline", () => {
    // RE-1: the daemon question is bounded, and a timeout is named as one (P1.34s, nit 3).
    expect(DOCKER_INFO_DEADLINE_MS).toBeGreaterThan(0);
    expect(DOCKER_INFO_DEADLINE_MS).toBeLessThanOrEqual(30_000);
    let deadline: number | undefined;
    run(plan(UP, {}), {
      ...runner(() => 0),
      capture: (_file, _args, _env, timeoutMs) => {
        deadline = timeoutMs;
        return { status: 0, signal: null, stdout: `x|${MACHINE}` };
      },
    });
    expect(deadline).toBe(DOCKER_INFO_DEADLINE_MS);
    const timedOut = Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" });
    const slow: Runner = {
      ...runner(() => 0),
      capture: () => ({ status: null, signal: "SIGKILL", stdout: "", error: timedOut }),
    };
    expect(() => run(plan(UP, {}), slow)).toThrow(new StackError("docker did not answer in time"));
  });

  test("the_socket_and_its_folder_are_only_root_or_the_deploy_user_s", () => {
    // P1.34s (architecture record 2026-10-12-workspace-imports-and-remote-daemon, Amendment 3): the socket's folder
    // passes resolveChecked unchanged, and the socket is a socket, not a link, root's or the deploy user's, nlink 1.
    const host = (DOCKER_HOST: string, extra: Record<string, Entry> = {}) =>
      localDockerHost({ DOCKER_HOST }, fakeHost({ ...HOST, ...extra }));
    expect(host(DEFAULT_DOCKER_HOST)).toBe(DEFAULT_DOCKER_HOST);
    expect(host("unix:///run/docker.sock")).toBe("unix:///run/docker.sock");
    const rootless = `unix:///run/user/${DEPLOY_UID}/docker.sock`;
    expect(host(rootless)).toBe(rootless);
    const refused = (reason: string) => new UsageError(`DOCKER_HOST must be a Docker socket on this machine${reason}`);
    const changeable = refused(": its folder is a path that another user can change");
    for (const [name, DOCKER_HOST, extra, reason] of [
      [
        "sticky /tmp",
        "unix:///tmp/docker.sock",
        { "/tmp": { kind: "dir", mode: 0o1777 }, "/tmp/docker.sock": SOCK },
        changeable,
      ],
      [
        "another user's folder",
        "unix:///run/user/7/docker.sock",
        { "/run/user/7": { kind: "dir", uid: 7, mode: 0o700 }, "/run/user/7/docker.sock": SOCK },
        changeable,
      ],
      [
        "a link another user owns",
        "unix:///srv/d/docker.sock",
        { "/srv": DIR, "/srv/d": { kind: "link", uid: 7, target: "/run" }, "/srv/d/docker.sock": SOCK },
        changeable,
      ],
      [
        "a link into a writable folder",
        "unix:///srv/d/docker.sock",
        {
          "/srv": DIR,
          "/srv/d": { kind: "link", target: "/tmp" },
          "/tmp": { kind: "dir", mode: 0o1777 },
          "/srv/d/docker.sock": SOCK,
        },
        changeable,
      ],
      [
        "under /proc",
        "unix:///proc/1/root/run/docker.sock",
        {
          "/proc": DIR,
          "/proc/1": DIR,
          "/proc/1/root": DIR,
          "/proc/1/root/run": DIR,
          "/proc/1/root/run/docker.sock": SOCK,
        },
        refused(": its folder is a path under /proc"),
      ],
      [
        "another user's socket",
        "unix:///run/docker.sock",
        { "/run/docker.sock": { ...SOCK, uid: 7 } },
        refused(": another user owns it"),
      ],
      [
        "a second hard link",
        "unix:///run/docker.sock",
        { "/run/docker.sock": { ...SOCK, nlink: 2 } },
        refused(": it has another name (a hard link)"),
      ],
      [
        "a link as the socket",
        "unix:///run/docker.sock",
        { "/run/docker.sock": { kind: "link", target: "/run/real.sock" }, "/run/real.sock": SOCK },
        refused(": it is a link, not the socket"),
      ],
      ["a regular file", "unix:///run/docker.sock", { "/run/docker.sock": { kind: "file" } }, refused("")],
      ["nothing there", "unix:///run/absent.sock", {}, refused("")],
    ] as const) {
      expect(() => host(DOCKER_HOST, extra as Record<string, Entry>), name).toThrow(reason);
    }
    // No reason echoes the value.
    expect(() => host("unix:///tmp/secret-name.sock", { "/tmp": { kind: "dir", mode: 0o1777 } })).not.toThrow(/secret/);
  });

  test("real_children_report_missing_killed_and_timed_out", () => {
    // P1.34s, nit 2: the process runner itself, with real children and no double. A child past its deadline is killed
    // with SIGKILL even when it traps SIGTERM, and reported as a timeout (Node v26.10.0: ETIMEDOUT, signal SIGKILL).
    const env = { PATH: process.env.PATH ?? "", HOME: tmpdir() };
    const node = (code: string) => [process.execPath, ["-e", code]] as const;
    expect(processRunner.spawn("/nonexistent/docker", [], env).error).toBeDefined();
    expect(processRunner.capture("/nonexistent/docker", [], env, 1_000).error).toBeDefined();
    const [file, args] = node("process.kill(process.pid, 'SIGKILL')");
    expect(processRunner.spawn(file, [...args], env)).toMatchObject({ status: null, signal: "SIGKILL" });
    const started = Date.now();
    const [slow, slowArgs] = node("process.on('SIGTERM', () => {}); setTimeout(() => {}, 20_000)");
    const late = processRunner.capture(slow, [...slowArgs], env, 300);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(late.signal).toBe("SIGKILL");
    expect((late.error as NodeJS.ErrnoException | undefined)?.code).toBe("ETIMEDOUT");
    const [ok, okArgs] = node("process.stdout.write('x|y')");
    expect(processRunner.capture(ok, [...okArgs], env, 5_000)).toMatchObject({
      status: 0,
      signal: null,
      stdout: "x|y",
    });
  });

  test("main_prints_one_fixed_line_and_exits_2", () => {
    // P1.34s, nit 2: a refusal or a failed child is one line on stderr and exit 2; a run that passes exits 0.
    const lines: string[] = [];
    const write = (line: string) => lines.push(line);
    expect(
      main(
        ["restart"],
        {},
        runner(() => 0),
        write,
        SOCKET,
      ),
    ).toBe(2);
    expect(
      main(UP, {}, { ...runner(() => 0), spawn: () => ({ status: null, signal: "SIGTERM" }) }, write, SOCKET),
    ).toBe(2);
    expect(lines).toEqual(["stack: the action is up or down\n", "stack: the preflight was stopped by SIGTERM\n"]);
    expect(
      main(
        UP,
        {},
        runner(() => 0),
        write,
        SOCKET,
      ),
    ).toBe(0);
    expect(() =>
      main(
        UP,
        {},
        {
          ...runner(() => 0),
          spawn: () => {
            throw new RangeError("bug");
          },
        },
        write,
        SOCKET,
      ),
    ).toThrow(RangeError);
  });
});
