// Discovery for the images workflow's scan matrix (P1.29w). The walk matches images.test.ts
// (deployment/images/images.test.ts): every Dockerfile under deployment/, nothing under node_modules.
// Ignore files are the script's map, never a file-name convention.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { entryProblems, IGNOREFILES, listDockerfiles } from "./list-dockerfiles.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const DOCKERFILE = /(^|\/)([\w.-]+\.)?Dockerfile$/;
/** A GitHub `${{ }}` expression, built so the source has no template placeholder. */
const gh = (inner: string): string => `$${"{{"} ${inner} }}`;
const GH_OPEN = `$${"{{"}`;

/** images.test.ts's walk, copied so a drift in the script fails this test. */
function liveDockerfiles(root: string): string[] {
  return (readdirSync(join(root, "deployment"), { encoding: "utf8", recursive: true }) as string[])
    .map((file) => file.split(sep).join("/"))
    .filter((file) => DOCKERFILE.test(file) && !file.includes("node_modules"))
    .map((file) => `deployment/${file}`)
    .sort();
}

/** The stem rule, copied so a drift in the script's names fails this test. */
function stem(dockerfile: string): string {
  const base = dockerfile.slice(dockerfile.lastIndexOf("/") + 1);
  if (base === "Dockerfile") {
    const parent = dockerfile.slice(0, dockerfile.lastIndexOf("/"));
    return parent.slice(parent.lastIndexOf("/") + 1);
  }
  const suffix = ".Dockerfile";
  return base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "list-dockerfiles-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

function runCli(root: string, output: string | undefined): { status: number | null; err: string; text: string } {
  const ran = spawnSync(process.execPath, [join(ROOT, "scripts/ci/list-dockerfiles.ts"), root], {
    env: { ...process.env, GITHUB_OUTPUT: output ?? "" },
    encoding: "utf8",
  });
  return {
    status: ran.status,
    err: ran.stderr,
    text: output === undefined ? "" : readFileSync(output, "utf8"),
  };
}

describe("list dockerfiles", () => {
  test("list_dockerfiles_matches_images_discovery", () => {
    const listed = listDockerfiles(ROOT);
    const walked = liveDockerfiles(ROOT);
    expect(listed.map((image) => image.dockerfile)).toEqual(walked);
    expect(listed.map((image) => image.name)).toEqual(walked.map(stem));
    // The book named {edge, node-app} on 2026-10-07. migrate.Dockerfile has since landed, so this
    // checks the live walk. A later Dockerfile is covered without editing this check (SE-6).
    // P1.29v emptied the map: every shipped image is scanned in full. A new entry is a loosening (Alex's card and line).
    expect(IGNOREFILES).toEqual({});
    for (const image of listed) expect(image.ignorefile, image.name).toBe("/dev/null");
    const output = join(mkdtempSync(join(tmpdir(), "list-dockerfiles-out-")), "github-output");
    writeFileSync(output, "");
    const cli = runCli(ROOT, output);
    expect(cli.status, cli.err).toBe(0);
    expect(cli.text).toBe(`images=${JSON.stringify(listed)}\n`);
    expect(runCli(ROOT, undefined).status).not.toBe(0);
  });

  test("list_dockerfiles_refuses_bad_entries", () => {
    const empty = tree({});
    mkdirSync(join(empty, "deployment"));
    expect(() => listDockerfiles(empty)).toThrow("no Dockerfiles under deployment/");

    const badName = tree({ "deployment/images/Bad_Name.Dockerfile": "FROM scratch\n" });
    expect(() => listDockerfiles(badName)).toThrow(/name does not match/);

    const outside = tree({ "deployment/edge/Dockerfile": "FROM scratch\n", "outside.Dockerfile": "FROM scratch\n" });
    symlinkSync(join(outside, "outside.Dockerfile"), join(outside, "deployment/escape.Dockerfile"));
    expect(() => listDockerfiles(outside)).toThrow(/path outside deployment\//);
    expect(entryProblems(outside, "../Dockerfile")).toEqual(["path outside deployment/: ../Dockerfile"]);
    expect(entryProblems(outside, "/etc/Dockerfile")).toEqual(["path outside deployment/: /etc/Dockerfile"]);
    expect(entryProblems(outside, "scripts/Dockerfile")).toEqual(["path outside deployment/: scripts/Dockerfile"]);

    const nested = tree({
      "deployment/node_modules/pkg/Dockerfile": "FROM scratch\n",
      "deployment/keep/Dockerfile": "FROM scratch\n",
      "deployment/keep/keep.trivyignore": "CVE-0000-00000\n",
    });
    const kept = listDockerfiles(nested);
    expect(kept.map((image) => image.dockerfile)).toEqual(["deployment/keep/Dockerfile"]);
    expect(kept[0]?.ignorefile).toBe("/dev/null");

    const dupes = tree({
      "deployment/edge/Dockerfile": "FROM scratch\n",
      "deployment/images/edge.Dockerfile": "FROM scratch\n",
    });
    expect(() => listDockerfiles(dupes)).toThrow(/duplicate image name edge/);

    for (const root of [empty, badName, outside, nested, dupes]) rmSync(root, { recursive: true, force: true });
  });

  test("scan_job_aggregates_discovered_images", () => {
    const text = readFileSync(join(ROOT, ".github/workflows/images.yml"), "utf8");
    const wf = parse(text) as {
      on: unknown;
      jobs: Record<
        string,
        {
          name?: string;
          needs?: string[];
          if?: string;
          outputs?: Record<string, string>;
          strategy?: { "fail-fast"?: boolean; matrix?: { include?: string } };
          steps?: { id?: string; run?: string }[];
        }
      >;
    };
    expect(JSON.stringify(wf.on)).not.toMatch(/paths/);
    const discover = wf.jobs.discover;
    expect(discover?.outputs?.images).toBe(gh("steps.list.outputs.images"));
    expect(discover?.steps?.find((step) => step.id === "list")?.run).toBe("node scripts/ci/list-dockerfiles.ts");
    const scanImage = wf.jobs["scan-image"];
    expect(scanImage?.name).toContain(gh("matrix.name"));
    expect(scanImage?.strategy?.["fail-fast"]).toBe(false);
    expect(scanImage?.strategy?.matrix?.include).toBe(gh("fromJSON(needs.discover.outputs.images)"));
    const built = (scanImage?.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(built).toMatch(/image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --ignorefile "\$IGNOREFILE"/);
    expect(built.includes(GH_OPEN)).toBe(false);
    const scan = wf.jobs.scan;
    expect(scan?.needs).toEqual(["discover", "scan-image", "scan-export"]);
    expect(scan?.if).toContain("always()");
    expect(scan?.if).toContain("github.event.pull_request.draft == false");
    const gate = (scan?.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(gate).toContain('"$DISCOVER" != success');
    expect(gate).toContain('"$SCAN_RESULT" != success');
    expect(gate).toContain('"$EXPORT_RESULT" != success');
    expect(gate.includes(GH_OPEN)).toBe(false);
  });
});
