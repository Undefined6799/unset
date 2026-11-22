// The docs repository's Pages workflow (P1.21t; ADR 0092), which lives here as deployment/docs-repo/site.yml and is
// copied there by docs-mirror.yml. It runs in another repository, out of reach of this one's workflow guard, so its
// rules are held here: the build CI runs here, GitHub's own pinned actions only, the publish rights in the deploy job
// alone. The step that turns the other repositories' folders into sections is run as written.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
type Step = { name?: string; id?: string; run?: string; shell?: string; uses?: string; with?: Record<string, unknown> };
type Job = {
  needs?: string;
  environment?: unknown;
  permissions?: unknown;
  env?: Record<string, string>;
  steps: Step[];
};
type Workflow = { on: unknown; permissions: unknown; jobs: Record<string, Job> };
const load = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const text = load("deployment/docs-repo/site.yml");
const site = parse(text) as Workflow;
const ci = parse(load(".github/workflows/ci.yml")) as Workflow;
const build = site.jobs.build as Job;
const deploy = site.jobs.deploy as Job;
const sections = build.steps.find((step) => step.name?.startsWith("Add every other")) as Step;

/** Runs the sections step in a checkout holding `files`, after `before` has added what a file map cannot say. */
function withFolders(files: Record<string, string>, before?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "unset-docs-site-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  before?.(root);
  expect(sections.shell).toBe("bash");
  const ran = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", sections.run ?? "exit 9"], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  return { root, code: ran.status, out: ran.stdout + ran.stderr };
}

const SITE = { "unset/site/hugo.yaml": "title: unset\n", "unset/site/content/overview/_index.md": "overview\n" };

describe("docs repository Pages workflow", () => {
  test("builds_the_site_the_way_ci_builds_it_here", () => {
    const here = ci.jobs["docs-site"] as Job;
    expect(build.env?.HUGO_IMAGE).toBe(here.env?.HUGO_IMAGE);
    expect(build.env?.HUGO_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
    const command = here.steps.find((step) => step.name === "Build the docs site")?.run;
    expect(command).toContain("-w /project/docs/site ");
    expect(build.steps.find((step) => step.name === "Build the site")?.run).toBe(
      command?.replace("-w /project/docs/site ", "-w /project/unset/site "),
    );
    // What is published is that build's output.
    expect(build.steps.at(-1)?.with).toEqual({ path: "unset/site/public" });
  });

  test("runs_on_a_push_to_main_with_githubs_pinned_actions_only", () => {
    expect(site.on).toEqual({ push: { branches: ["main"] }, workflow_dispatch: null });
    const uses = [...build.steps, ...deploy.steps].flatMap((step) => (step.uses ? [step.uses] : []));
    expect(uses.map((action) => action.replace(/@.*/, ""))).toEqual([
      "actions/checkout",
      "actions/upload-pages-artifact",
      "actions/deploy-pages",
    ]);
    for (const action of uses) expect(action).toMatch(/^actions\/[\w-]+@[0-9a-f]{40}$/);
    // The checkout is the one this repository pins, and keeps no token.
    expect(uses[0]).toBe((ci.jobs["docs-site"] as Job).steps[0]?.uses);
    expect(build.steps[0]?.with).toEqual({ "persist-credentials": false });
    // No secret, and no expression inside a script.
    expect(text).not.toContain("secrets.");
    for (const step of build.steps) expect(step.run ?? "").not.toContain("${{");
  });

  test("only_the_deploy_job_may_publish", () => {
    expect(site.permissions).toEqual({});
    // Compared as one string: a list that starts with the build job's name reads as an image build to
    // scripts/test/image-rules.test.ts, and this test builds none.
    expect(Object.keys(site.jobs).join(", ")).toBe("build, deploy");
    expect(build.permissions).toEqual({ contents: "read" });
    expect(deploy.permissions).toEqual({ pages: "write", "id-token": "write" });
    expect(deploy.needs).toBe("build");
    expect(deploy.environment).toMatchObject({ name: "github-pages" });
    // The job that can publish runs GitHub's deploy action and nothing else: no checkout, no script.
    expect(deploy.steps).toHaveLength(1);
    expect(deploy.steps[0]?.uses).toMatch(/^actions\/deploy-pages@/);
  });

  test("every_other_top_folder_becomes_a_section", () => {
    const ran = withFolders({
      ...SITE,
      "lexicons/_index.md": "lexicons\n",
      "lexicons/records/card.md": "card\n",
      "README.md": "front\n",
      ".github/workflows/site.yml": "name: site\n",
    });
    expect(ran).toMatchObject({ code: 0 });
    const content = join(ran.root, "unset/site/content");
    expect(readFileSync(join(content, "lexicons/records/card.md"), "utf8")).toBe("card\n");
    // The site's own folder, the front page and the workflow folder are not sections.
    expect(existsSync(join(content, "unset"))).toBe(false);
    expect(existsSync(join(content, ".github"))).toBe(false);
    expect(existsSync(join(content, "README.md"))).toBe(false);
  });

  test("a_folder_named_like_an_existing_section_fails", () => {
    const ran = withFolders({ ...SITE, "overview/_index.md": "another overview\n" });
    expect(ran.code).toBe(1);
    expect(ran.out).toContain("::error title=site::the folder overview");
    expect(readFileSync(join(ran.root, "unset/site/content/overview/_index.md"), "utf8")).toBe("overview\n");
  });

  test("a_link_anywhere_fails", () => {
    const ran = withFolders({ ...SITE, "lexicons/_index.md": "lexicons\n" }, (root) =>
      symlinkSync("/etc/hostname", join(root, "lexicons/host.md")),
    );
    expect(ran.code).toBe(1);
    expect(ran.out).toContain("::error title=site::./lexicons/host.md is a link");
    expect(existsSync(join(ran.root, "unset/site/content/lexicons"))).toBe(false);
  });
});
