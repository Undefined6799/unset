// The wiring of the P0.09c change-shape checks: the CI job, the hook, Renovate's titles and the labels.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { code, jobs } from "./workflows.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("wiring", () => {
  test("title_never_interpolated", () => {
    const workflow = read(".github/workflows/pr-shape.yml");
    const job = jobs(code(workflow)).get("pr-shape");
    expect(job).toBeDefined();
    const text = (job ?? []).join("\n");
    // Every PR value reaches the script through env:, never through ${{ }} in a run: line.
    for (const name of ["PR_TITLE", "PR_BODY", "PR_LABELS", "BASE_SHA", "HEAD_SHA"]) {
      expect(text).toMatch(new RegExp(`^ {6}${name}: \\$\\{\\{ [^}]+ \\}\\}$`, "m"));
    }
    expect(text).toContain("run: node scripts/guards/change-shape.ts");
    expect(text).toMatch(/if: github\.event_name == 'pull_request'/);
    expect(text).toMatch(/contents: read\n\s+pull-requests: read/);
    // An edited title, body or label set is checked again: the title becomes the squash subject.
    expect(workflow).toContain("types: [opened, synchronize, reopened, edited, labeled, unlabeled]");
  });

  test("hook_runs_check", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-msg-"));
    temps.push(dir);
    const run = (message: string): number => {
      const file = join(dir, "COMMIT_EDITMSG");
      writeFileSync(file, message);
      try {
        execFileSync("sh", [join(ROOT, ".githooks/commit-msg"), file], { cwd: ROOT, stdio: "pipe" });
        return 0;
      } catch (error) {
        return (error as { status: number }).status;
      }
    };
    expect(run("fix: thing\n")).toBe(1);
    // `git merge` runs the hook too, so the subjects git writes for a merge pass here (and only here).
    expect(run("Merge branch 'main' into claude/p0-09c\n")).toBe(0);
    expect(run("Merge pull request #30 from Undefined6799/claude/x\n\nP0.09b Add triage\n")).toBe(0);
    // Git's comment lines and the scissors line are not part of the message.
    expect(run("P0.09c Check the shape of every change\n# Please enter the commit message\n")).toBe(0);
    expect(
      run(
        `P0.09c Check the shape\n\nBody.\n# ------------------------ >8 ------------------------\n${"x".repeat(90)}\n`,
      ),
    ).toBe(0);
  });

  test("job_reads_git_safely", () => {
    // A throwaway repository: the template and a CODEOWNERS without the "# checks:" line on the base (as main had
    // before P0.09c), then a PR that adds the line and touches a trusted-base file with a non-ASCII name beside a
    // feature file. Without `git -z` the quoted path matched nothing.
    const dir = mkdtempSync(join(tmpdir(), "pr-shape-"));
    temps.push(dir);
    const sh = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
    const put = (path: string, text: string) => {
      execFileSync("mkdir", ["-p", join(dir, path, "..")]);
      writeFileSync(join(dir, path), text);
    };
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "test@example.org");
    sh("config", "user.name", "test");
    const withoutChecks = read(".github/CODEOWNERS").replace(/^# checks:.*\n/m, "");
    put(".github/CODEOWNERS", withoutChecks);
    put(".github/pull_request_template.md", read(".github/pull_request_template.md"));
    sh("add", "-A");
    sh("commit", "-q", "-m", "P0.01 Start");
    const base = sh("rev-parse", "HEAD");
    put("shared/http/gaté.ts", "export {};\n");
    put("domains/content/x.ts", "export {};\n");
    put(".github/CODEOWNERS", read(".github/CODEOWNERS"));
    sh("add", "-A");
    sh("commit", "-q", "-m", "P1.07 Change the gate");
    const env = {
      ...process.env,
      PR_TITLE: "P1.07 Change the gate",
      PR_BODY: read(".github/pull_request_template.md"),
      PR_LABELS: '["kind/fix"]',
      BASE_SHA: base,
      HEAD_SHA: sh("rev-parse", "HEAD"),
    };
    const job = (over: Record<string, string> = {}) => {
      try {
        return {
          status: 0,
          out: execFileSync("node", [join(ROOT, "scripts/guards/change-shape.ts")], {
            cwd: dir,
            env: { ...env, ...over },
            encoding: "utf8",
          }),
        };
      } catch (error) {
        const e = error as { status: number; stdout: string };
        return { status: e.status, out: e.stdout };
      }
    };
    const run = job();
    expect(run.status).toBe(1);
    // .github/CODEOWNERS is a check path, so both product paths fail; the non-ASCII one matched only through -z.
    expect(run.out).toContain(
      "::error::[SE-6] a PR that changes a check path changes no product path: domains/content/x.ts, shared/http/gaté.ts",
    );
    // shared/http/ is trusted base, so the PR's other files are outside it.
    expect(run.out).toContain(
      "::error::[SE-6] outside the trusted base in a trusted-base PR: .github/CODEOWNERS, domains/content/x.ts",
    );
    // With the line on neither side, nothing says which paths are checks: fail closed.
    put(".github/CODEOWNERS", withoutChecks);
    sh("commit", "-q", "-am", "P1.07 Drop the line");
    expect(job({ HEAD_SHA: sh("rev-parse", "HEAD") }).out).toContain(
      'neither CODEOWNERS section has "# checks:" paths',
    );
    expect(job({ BASE_SHA: "--output=/tmp/x" })).toEqual({ status: 1, out: "::error::BASE_SHA is not a commit id\n" });
    // Git's mode decides documentation: a regular LICENSE is exempt, a symlink named LICENSE is judged by its location.
    sh("checkout", "-q", "-b", "licence", base);
    put(".github/CODEOWNERS", read(".github/CODEOWNERS"));
    put("shared/config/LICENSE", "MIT License\n");
    execFileSync("mkdir", ["-p", join(dir, "shared/http")]);
    symlinkSync("../config/LICENSE", join(dir, "shared/http/LICENSE"));
    sh("add", "-A");
    sh("commit", "-q", "-m", "P0.13 Add the licences");
    expect(job({ HEAD_SHA: sh("rev-parse", "HEAD") }).out).toContain(
      "::error::[SE-6] a PR that changes a check path changes no product path: shared/http/LICENSE\n",
    );
  });

  test("lockfile_rides_end_to_end", () => {
    // Ruling 2026-10-05 02:50Z through real git: the root lockfile rides only when a trusted package.json's dependency
    // fields change; a scripts-only or unreadable manifest change leaves it outside the trusted base.
    const dir = mkdtempSync(join(tmpdir(), "pr-shape-lock-"));
    temps.push(dir);
    const sh = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
    const put = (path: string, text: string) => {
      execFileSync("mkdir", ["-p", join(dir, path, "..")]);
      writeFileSync(join(dir, path), text);
    };
    const manifest = (fields: object) => `${JSON.stringify({ name: "@unset/shared-http", ...fields }, null, 2)}\n`;
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "test@example.org");
    sh("config", "user.name", "test");
    put(".github/CODEOWNERS", read(".github/CODEOWNERS"));
    put(".github/pull_request_template.md", read(".github/pull_request_template.md"));
    put("shared/http/package.json", manifest({ dependencies: { a: "1.0.0" } }));
    const lockfile = (dependencies: object, extra: object = {}) => {
      const workspace = { name: "@unset/shared-http", dependencies };
      const packages = { "shared/http": workspace, "node_modules/a": { version: "1.0.0" }, ...extra };
      return `${JSON.stringify({ lockfileVersion: 3, packages })}\n`;
    };
    put("package-lock.json", lockfile({ a: "1.0.0" }));
    sh("add", "-A");
    sh("commit", "-q", "-m", "P0.01 Start");
    const base = sh("rev-parse", "HEAD");
    const prWith = (branch: string, manifestText: string) => {
      sh("checkout", "-q", "-b", branch, base);
      put("shared/http/package.json", manifestText);
      put("shared/http/server.ts", "export {};\n");
      const hono = { "node_modules/hono": { version: "4.0.0" } };
      put("package-lock.json", lockfile({ a: "1.0.0", hono: "4.0.0" }, hono));
      sh("add", "-A");
      sh("commit", "-q", "-m", "P1.04k Add the server kit");
      try {
        return execFileSync("node", [join(ROOT, "scripts/guards/change-shape.ts")], {
          cwd: dir,
          env: {
            ...process.env,
            PR_TITLE: "P1.04k Add the server kit",
            PR_BODY: read(".github/pull_request_template.md"),
            PR_LABELS: '["kind/build"]',
            BASE_SHA: base,
            HEAD_SHA: sh("rev-parse", "HEAD"),
          },
          encoding: "utf8",
        });
      } catch (error) {
        return (error as { stdout: string }).stdout;
      }
    };
    const outside = "::error::[SE-6] outside the trusted base in a trusted-base PR: package-lock.json";
    expect(prWith("deps", manifest({ dependencies: { a: "1.0.0", hono: "4.0.0" } }))).not.toContain("[SE-6]");
    expect(prWith("scripts", manifest({ dependencies: { a: "1.0.0" }, scripts: { x: "y" } }))).toContain(outside);
    expect(prWith("broken", "{ not json")).toContain(outside);
  });
});
