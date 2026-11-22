// docs-mirror.yml's own rules (P1.21t; ADR 0093), on top of the repository-wide workflow guard
// (scripts/guards/workflows.ts): what starts it, what the one job that holds the deploy key may do, and what its push
// step does to a docs repository that other source repositories write to as well. The push step is run here as
// written, under the shell the step declares, against a throwaway repository cloned the way actions/checkout clones
// (one commit deep).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { fixtureGitEnv } from "../guards/git-env.ts";
import { docsTree } from "./docs-export.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const FILE = ".github/workflows/docs-mirror.yml";
const text = readFileSync(join(ROOT, FILE), "utf8");

type Step = { name?: string; run?: string; shell?: string; uses?: string; with?: Record<string, unknown> };
type Job = { if?: string; environment?: unknown; permissions?: unknown; env?: unknown; steps: Step[] };
const workflow = parse(text) as { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Job> };
const job = workflow.jobs.mirror as Job;
const pushStep = job.steps.at(-1) as Step;
// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template.
const KEY = "${{ secrets.DOCS_DEPLOY_KEY }}";
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** The fixture environment without its fixed identity, so the push step's own `git config` names the committer. */
const STEP_ENV = Object.fromEntries(
  Object.entries(fixtureGitEnv()).filter(([name]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(name)),
);
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, env: fixtureGitEnv(), encoding: "utf8", stdio: "pipe" }).trim();

function write(root: string, files: Record<string, string>): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
}

/** Commits `files` in a clone of `remote` and pushes them, as another source repository's job would. */
function pushFromElsewhere(remote: string, files: Record<string, string>, subject: string): void {
  const clone = mkdtempSync(join(tmpdir(), "unset-docs-other-"));
  git(clone, "clone", "--quiet", remote, ".");
  write(clone, files);
  git(clone, "add", "--all");
  git(clone, "commit", "--quiet", "-m", subject);
  git(clone, "push", "--quiet", "origin", "HEAD");
}

/**
 * A docs repository holding a front page, a workflow, the lexicons folder and an older copy of ours; the workspace of a run
 * with that repository checked out one commit deep at `docs-repo`; and `tree` as this run's export.
 */
function staged(tree: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "unset-docs-mirror-"));
  const remote = join(dir, "docs.git");
  mkdirSync(remote);
  git(remote, "init", "--quiet", "--bare");
  pushFromElsewhere(
    remote,
    {
      "README.md": "old front page\n",
      "lexicons/card.md": "card\n",
      "unset/site/gone.md": "gone\n",
      ".github/workflows/gone.yml": "name: gone\n",
    },
    "Start",
  );
  const workspace = join(dir, "workspace");
  mkdirSync(workspace);
  git(workspace, "clone", "--quiet", "--depth", "1", `file://${remote}`, "docs-repo");
  write(join(dir, "tree"), tree);
  writeFileSync(join(dir, "summary"), "");
  const run = () => {
    // How Actions runs a `run:` step with `shell: bash` (docs.github.com, workflow syntax, jobs.<job_id>.steps[*].shell).
    expect(pushStep.shell).toBe("bash");
    const ran = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", pushStep.run ?? "exit 9"], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...STEP_ENV,
        RUNNER_TEMP: dir,
        GITHUB_STEP_SUMMARY: join(dir, "summary"),
        GITHUB_REPOSITORY: "Undefined6799/unset",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_SHA: SHA,
      },
    });
    return { code: ran.status, out: ran.stdout + ran.stderr };
  };
  const log = (format: string): string[] => git(remote, "log", `--format=${format}`).split("\n");
  const files = (): string[] => git(remote, "ls-tree", "-r", "--name-only", "HEAD").split("\n");
  const show = (path: string): string => git(remote, "show", `HEAD:${path}`);
  return { remote, run, log, files, show, summary: () => readFileSync(join(dir, "summary"), "utf8") };
}

const TREE = {
  "README.md": "front page\n",
  ".github/workflows/site.yml": "name: site\n",
  "unset/site/page.md": "page\n",
  "unset/human/glossary.md": "words\n",
};

describe("docs mirror workflow", () => {
  test("runs_only_for_a_push_to_main_that_changes_what_it_copies", () => {
    expect(workflow.on).toEqual({
      push: {
        branches: ["main"],
        paths: ["docs/human/**", "docs/site/**", "deployment/docs-repo/**", "scripts/ci/docs-export.ts", FILE],
      },
    });
    // Every file the export copies is under one of those paths.
    const prefixes = ["docs/human/", "docs/site/", "deployment/docs-repo/"];
    expect([...docsTree().values()].filter((path) => !prefixes.some((prefix) => path.startsWith(prefix)))).toEqual([]);
    for (const path of ["docs/human", "docs/site", "deployment/docs-repo", "scripts/ci/docs-export.ts"])
      expect(existsSync(join(ROOT, path)), path).toBe(true);
  });

  test("one_job_holds_the_key_and_only_to_check_out_the_docs_repository", () => {
    expect(workflow.permissions).toEqual({});
    expect(Object.keys(workflow.jobs)).toEqual(["mirror"]);
    expect(job.environment).toBe("docs-mirror");
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.env).toBeUndefined();
    // The key appears once in the file: as the ssh-key of the checkout of the docs repository.
    expect(text.split("secrets.").length - 1).toBe(1);
    const holders = job.steps.filter((step) => JSON.stringify(step).includes("secrets."));
    expect(holders).toHaveLength(1);
    expect(holders[0]?.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    expect(holders[0]?.with).toEqual({ repository: "unset-sh/docs", "ssh-key": KEY, path: "docs-repo" });
    // This repository is checked out first, without keeping its token.
    expect(job.steps[0]?.uses).toBe(holders[0]?.uses);
    expect(job.steps[0]?.with).toEqual({ "persist-credentials": false });
    // Beside the key the job runs only our own export script and git: no package install, no forced push.
    const runs = job.steps.map((step) => step.run ?? "").join("\n");
    expect(runs).not.toMatch(/\bnpm\b|\bnpx\b|\bcurl\b|\bwget\b/);
    expect(runs).not.toMatch(/--force|--mirror|push\s+(?:\S+\s+)*-f\b|push[^\n]*\s\+/);
    expect(runs).toContain('node scripts/ci/docs-export.ts "$RUNNER_TEMP/tree"');
  });

  test("the_push_step_names_every_path_the_export_writes_and_no_other", () => {
    // The step removes and stages `unset`, `README.md` and `.github` by name; the export must write nothing outside them.
    const top = new Set([...docsTree().keys()].map((path) => path.split("/")[0]));
    expect([...top].sort()).toEqual([".github", "README.md", "unset"]);
    expect(pushStep.run).toContain("git rm -r --quiet --ignore-unmatch -- unset README.md .github\n");
    expect(pushStep.run).toContain("git add --all -- unset README.md .github\n");
  });

  test("replaces_its_own_part_in_one_commit_and_leaves_the_rest", () => {
    const docs = staged(TREE);
    expect(docs.run()).toMatchObject({ code: 0 });
    expect(docs.files()).toEqual([
      ".github/workflows/site.yml",
      "README.md",
      "lexicons/card.md",
      "unset/human/glossary.md",
      "unset/site/page.md",
    ]);
    expect(docs.show("README.md")).toBe("front page");
    expect(docs.show("lexicons/card.md")).toBe("card");
    expect(docs.log("%s")).toEqual(["Copy the docs from Undefined6799/unset@0123456", "Start"]);
    expect(docs.log("%an <%ae>%n%b")[0]).toBe(
      "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>",
    );
    expect(docs.log("%b")[0]).toBe(`Source: https://github.com/Undefined6799/unset/commit/${SHA}`);
    // A second run of the same tree pushes nothing.
    expect(docs.run()).toMatchObject({ code: 0 });
    expect(docs.log("%s")).toHaveLength(2);
    expect(docs.summary()).toContain("already holds");
  });

  test("a_file_the_export_did_not_name_is_not_pushed", () => {
    const docs = staged({ ...TREE, "lexicons/card.md": "overwritten\n", "stray.md": "stray\n" });
    expect(docs.run()).toMatchObject({ code: 0 });
    expect(docs.show("lexicons/card.md")).toBe("card");
    expect(docs.files()).not.toContain("stray.md");
  });

  test("a_push_that_lost_a_race_is_replayed_on_top_never_forced", () => {
    const docs = staged(TREE);
    // Another source repository pushes its own folder after our checkout and before our push.
    pushFromElsewhere(docs.remote, { "lexicons/page.md": "page record\n" }, "Copy the lexicon docs");
    expect(docs.run()).toMatchObject({ code: 0 });
    expect(docs.log("%s")).toEqual([
      "Copy the docs from Undefined6799/unset@0123456",
      "Copy the lexicon docs",
      "Start",
    ]);
    expect(docs.files()).toEqual([
      ".github/workflows/site.yml",
      "README.md",
      "lexicons/card.md",
      "lexicons/page.md",
      "unset/human/glossary.md",
      "unset/site/page.md",
    ]);
  });

  test("a_push_that_cannot_be_replayed_cleanly_fails_and_changes_nothing", () => {
    const docs = staged(TREE);
    // Someone else wrote into our folder: the two commits disagree, and the run must not pick a winner.
    pushFromElsewhere(docs.remote, { "unset/site/page.md": "written by hand\n" }, "Edit by hand");
    expect(docs.run().code).not.toBe(0);
    expect(docs.log("%s")).toEqual(["Edit by hand", "Start"]);
    expect(docs.show("unset/site/page.md")).toBe("written by hand");
  });

  test("a_push_the_docs_repository_keeps_refusing_fails", () => {
    const docs = staged(TREE);
    write(docs.remote, { "hooks/pre-receive": "#!/bin/sh\nexit 1\n" });
    execFileSync("chmod", ["+x", join(docs.remote, "hooks/pre-receive")]);
    const ran = docs.run();
    expect(ran.code).toBe(1);
    expect(ran.out).toContain("::error title=docs-mirror::");
    expect(docs.log("%s")).toEqual(["Start"]);
  });
});
