// lexicons-mirror.yml's own rules (P1.31v; ADR 0089), on top of the repository-wide workflow guard
// (scripts/guards/workflows.ts): what starts it, and what the one job that holds the deploy key may do.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
const FILE = ".github/workflows/lexicons-mirror.yml";
const text = readFileSync(join(ROOT, FILE), "utf8");

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: unknown };
type Job = { if?: string; environment?: unknown; permissions?: unknown; env?: unknown; steps: Step[] };
const workflow = parse(text) as { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Job> };
// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template.
const KEY = "${{ secrets.LEXICONS_DEPLOY_KEY }}";

describe("lexicons mirror workflow", () => {
  test("runs_only_for_a_push_to_main_that_changes_the_public_tree", () => {
    expect(workflow.on).toEqual({
      push: {
        branches: ["main"],
        paths: [
          "shared/lexicons/schemas/**",
          "shared/lexicons/public-repo/**",
          "shared/lexicons/LICENSE",
          "scripts/ci/lexicons-export.ts",
          FILE,
        ],
      },
    });
    // The folders and files the tree is built from (scripts/ci/lexicons-export.ts) exist under those paths.
    for (const path of ["shared/lexicons/schemas", "shared/lexicons/public-repo", "shared/lexicons/LICENSE"])
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    expect(existsSync(join(ROOT, "scripts/ci/lexicons-export.ts"))).toBe(true);
  });

  test("one_job_holds_the_key_and_only_to_check_out_the_public_repository", () => {
    expect(workflow.permissions).toEqual({});
    expect(Object.keys(workflow.jobs)).toEqual(["mirror"]);
    const job = workflow.jobs.mirror as Job;
    expect(job.environment).toBe("lexicons-mirror");
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.env).toBeUndefined();
    // The key appears once in the file: as the ssh-key of the checkout of the public repository.
    expect(text.split("secrets.").length - 1).toBe(1);
    const holders = job.steps.filter((step) => JSON.stringify(step).includes("secrets."));
    expect(holders).toHaveLength(1);
    expect(holders[0]?.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    expect(holders[0]?.with).toEqual({ repository: "unset-sh/lexicons", "ssh-key": KEY, path: "public" });
    // This repository is checked out first, without keeping its token.
    expect(job.steps[0]?.uses).toBe(holders[0]?.uses);
    expect(job.steps[0]?.with).toEqual({ "persist-credentials": false });
    // Beside the key the job runs only our own export script and git: no package install, no forced push.
    const runs = job.steps.map((step) => step.run ?? "").join("\n");
    expect(runs).not.toMatch(/\bnpm\b|\bnpx\b|\bcurl\b|\bwget\b/);
    expect(runs).not.toMatch(/--force|--mirror|push\s+(?:\S+\s+)*-f\b|push[^\n]*\s\+/);
    expect(runs).toContain('node scripts/ci/lexicons-export.ts "$RUNNER_TEMP/tree"');
    expect(runs).toContain("git push --quiet origin HEAD\n");
  });
});
