// The CI supply-chain and privilege rules (P0.07) over one workflow file.
// Line-based on purpose: the rules are about what the YAML says, and a parser would be one more dependency.
import { createHash } from "node:crypto";

/** The only shape a secret- or OIDC-using job may have: bound to an environment and run only for pushes to main. */
export const GATE_IF = "if: github.event_name == 'push' && github.ref == 'refs/heads/main'";

/** One line without its `#` comment; a `#` inside a quoted scalar is text, not a comment. */
function stripComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) return line.slice(0, i);
  }
  return line;
}

/** Drops comments, keeping line numbers. */
export function code(text: string): string[] {
  return text.split("\n").map(stripComment);
}

const indent = (line: string): number => line.length - line.trimStart().length;

/** Each job's id and its lines, from the `jobs:` map. */
export function jobs(lines: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  let current: string[] | undefined;
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    if (line.trim() !== "" && indent(line) === 0) break;
    const id = /^ {2}([\w-]+):\s*$/.exec(line)?.[1];
    if (id) {
      current = [];
      out.set(id, current);
    } else current?.push(line);
  }
  return out;
}

/** The value of every `run:` key, block scalars included. */
function runValues(lines: string[]): string[] {
  const values: string[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)(?:- )?["']?run["']?:\s*(.*)$/.exec(line);
    if (!m) return;
    const keyIndent = (m[1] ?? "").length;
    const value = [m[2] ?? ""];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== "" && indent(next) <= keyIndent) break;
      value.push(next);
    }
    values.push(value.join("\n"));
  });
  return values;
}

/**
 * The one accepted `buildx create` line: plain `--flag value` options, `--use` and the literal
 * `--driver-opt default-load=true` (P1.27t; it names no image) around a single quoted, pinned driver option. Every other flag takes a value that never starts with `-`, so no option can pose as another's value
 * (pflag would take it as one), and the option groups are bounded so a refused line cannot backtrack far.
 */
const FIXED_BUILDER =
  /^\s*(?:- )?(?:run:\s*)?docker buildx create(?: (?:--use|--driver-opt default-load=true|--[a-z][a-z-]* [\w.][\w.-]*)){0,8} --driver-opt "image=(?:\$\w+_IMAGE|[\w./:-]+@sha256:[0-9a-f]{64})"(?: (?:--use|--driver-opt default-load=true|--[a-z][a-z-]* [\w.][\w.-]*)){0,8}\s*$/;

/**
 * The one accepted pull of a runtime ref (P2.24c): publish-images.yml pulls the digest it just pushed, `$ref`, so its
 * scan can name the image as images.yml does. It passes only in that file, only inside a `run: |` block, and only
 * straight after the two lines of that same block that set `$ref` from the build's own digest and exit unless it ends
 * in `@sha256:` and 64 characters (Codex on #1276). Equal indentation with nothing but blank or comment lines between
 * keeps all three in one block scalar, so one shell: a new step needs a `- run:` line, which breaks the chain. Any
 * other file, spelling, step or preceding line still fails.
 */
const PUSHED_DIGEST_PULL = /^(\s*)docker pull --quiet --platform linux\/amd64 "\$ref" > \/dev\/null\s*$/;
const PUSHED_REF =
  /^(\s*)ref="\$REGISTRY\/\$name@\$\(jq -r '\."containerimage\.digest"' "\$RUNNER_TEMP\/meta\.json"\)"\s*$/;
const DIGEST_CHECK = /^(\s*)case "\$ref" in \*@sha256:\?{64}\) ;; \*\) exit 1 ;; esac\s*$/;

/** Whether line `i` is publish-images.yml's pull of the digest set and checked on the two lines before it, in one block. */
function isPushedDigestPull(file: string, lines: readonly string[], i: number): boolean {
  const before = lines.slice(0, i).filter((line) => line.trim() !== "");
  const indents = [
    PUSHED_REF.exec(before.at(-2) ?? "")?.[1],
    DIGEST_CHECK.exec(before.at(-1) ?? "")?.[1],
    PUSHED_DIGEST_PULL.exec(lines[i] ?? "")?.[1],
  ];
  return file === "publish-images.yml" && indents.every((indent) => indent !== undefined && indent === indents[2]);
}

const UNPINNED_RUN = "container started without a digest-pinned image";

/**
 * Pinning, trigger and permission problems visible on one line. An action is a GitHub-owned repository at a full
 * commit SHA. The only sub-actions accepted are actions/cache's restore and save (P0.07m: e2e.yml keeps apt packages
 * after a failed install, which the combined action's post step, `post-if: success()`, does not); they are folders of
 * the same repository at the same SHA (actions/cache v6.1.0 restore/README.md, save/README.md).
 */
function lineProblems(line: string): string[] {
  const found: string[] = [];
  const uses = /\buses["']?:\s*["']?([^\s"']+)/.exec(line)?.[1];
  if (uses && !uses.startsWith("./") && !/^actions\/(?:[\w.-]+|cache\/restore|cache\/save)@[0-9a-f]{40}$/.test(uses)) {
    found.push(`action not GitHub-owned and SHA-pinned: ${uses}`);
  }
  // github-script runs its `script:` input as code, out of reach of the no-expression-in-run rule.
  if (uses?.startsWith("actions/github-script@")) found.push("actions/github-script is not allowed");
  const image = /(?:\b\w*_IMAGE|\bimage|\bcontainer):\s*["']?([^\s"'{]+)/.exec(line)?.[1];
  if (image && !/@sha256:[0-9a-f]{64}$/.test(image)) found.push(`image not pinned by digest: ${image}`);
  if (/\b(?:docker|podman)\s+(?:container\s+|image\s+)?(?:run|create|pull)\b/.test(line)) {
    if (!/"\$\w+_IMAGE"|@sha256:[0-9a-f]{64}/.test(line)) found.push(UNPINNED_RUN);
  }
  // A BuildKit container builder runs an image too (P1.27s). buildx reads driver options as CSV (csvvalue.Fields) and
  // keeps the last `image=`, and the shell can build quotes at run time, so no list of spellings is complete: the line
  // has one fixed shape, with exactly one driver option naming the image by digest or through a pinned variable, and
  // nothing else on it that the shell expands or quotes (verify-1150, Codex on #1206).
  if (/\bbuildx\s+create\b/.test(line) && !FIXED_BUILDER.test(line)) {
    found.push("BuildKit builder without a digest-pinned image");
  }
  // An image variable may only come from the workflow text, where the digest check above can see it.
  if (/_IMAGE=/.test(line) && /\bGITHUB_ENV\b/.test(line)) found.push("image variable written at run time");
  if (/\bpull_request_target\b/.test(line) || /\bworkflow_run\b/.test(line)) found.push("banned trigger");
  // id-token and packages are judged per job by signingProblems. contents and pull-requests writes are
  // judged by docsAutoMergeProblems: only docs-auto-merge.yml (P0.07e) and publish-images.yml's bump job (P2.26m).
  found.push(...otherWriteProblems(line));
  return found;
}

/** A job that touches a secret or OIDC without the environment + main-only gate. */
function ungated(body: string[]): boolean {
  const text = body.join("\n");
  const privileged =
    /\b(?:id-token|packages):\s*write\b/.test(text) || /\$\{\{[^}]*\bsecrets\b(?!\.GITHUB_TOKEN\b)/.test(text);
  const gated = /^ {4}environment:\s*\S/m.test(text) && body.some((l) => l.trim() === GATE_IF && indent(l) === 4);
  return privileged && !gated;
}

/**
 * The only jobs that sign (P1.27s; ADR 0033, Decision 1): each runs in the `signing` environment and alone may hold
 * `id-token: write` and, as a job-level block entry, `packages: write`.
 */
export const SIGNING_JOBS: Readonly<Record<string, string>> = {
  "publish-images.yml": "publish",
  "mirror.yml": "copy-and-sign",
};

const CACHE = /\bactions\/cache@|^\s*(?:- )?cache(?:-dependency-path)?:|\bcache-(?:from|to)\b/;

/** One job's signing problems: OIDC or package writes outside a signing job, and a signing job's required shape. */
function jobSigningProblems(file: string, id: string, body: string[]): string[] {
  const found: string[] = [];
  const signing = SIGNING_JOBS[file] === id;
  if (body.some((l) => /\bid-token["']?\s*:\s*["']?write\b/.test(l)) && !signing)
    found.push("id-token: write outside a signing job");
  body.forEach((line, i) => {
    if (!/\bpackages["']?\s*:\s*["']?write\b/.test(line)) return;
    const header = body.slice(0, i).findLast((l) => l.trim() !== "" && indent(l) <= 4);
    if (!signing) found.push("packages: write outside a signing job");
    else if (line !== "      packages: write" || header !== "    permissions:")
      found.push("packages: write not at job level");
  });
  if (!signing) return found;
  if (!body.some((l) => l === "    environment: signing")) found.push("a signing job not in the signing environment");
  if (body.some((l) => CACHE.test(l))) found.push("a cache in a signing job");
  if (setupNodeSteps(body).some((step) => !cacheOffInWith(step)))
    found.push("setup-node without package-manager-cache: false in a signing job");
  return found;
}

/**
 * Each setup-node step's lines. setup-node v7 caches npm on its own when package.json names a package manager
 * (action.yml `package-manager-cache`, default true, at 8207627), which the CACHE pattern cannot see, so a signing job
 * turns it off by name (verify-1150 S3).
 */
function setupNodeSteps(body: string[]): string[][] {
  const starts = body.flatMap((line, i) => (/^ {6}- /.test(line) ? [i] : []));
  return starts
    .map((start, k) => {
      const next = starts[k + 1] ?? body.length;
      const end = body.findIndex((l, j) => j > start && l.trim() !== "" && indent(l) <= 6);
      return body.slice(start, end < 0 ? next : Math.min(end, next));
    })
    .filter((step) => step.some((l) => /\buses["']?\s*:\s*["']?actions\/setup-node@/.test(l)));
}

/** Whether a setup-node step turns the cache off as an action input: under its own `with:` map, not `env:` or elsewhere. */
function cacheOffInWith(step: string[]): boolean {
  const start = step.findIndex((l) => /^ {8}with:\s*$/.test(l));
  if (start < 0) return false;
  const end = step.findIndex((l, j) => j > start && l.trim() !== "" && indent(l) <= 8);
  return step.slice(start + 1, end < 0 ? step.length : end).includes("          package-manager-cache: false");
}

/** The signing rules over one file: per job, plus publish-images.yml's own shape (no pull request, one job). */
function signingProblems(file: string, lines: string[]): string[] {
  const all = jobs(lines);
  const found = [...all].flatMap(([id, body]) => jobSigningProblems(file, id, body).map((p) => `job ${id}: ${p}`));
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (
    lines
      .slice(0, start < 0 ? lines.length : start)
      .some((l) => /\b(?:id-token|packages)["']?\s*:\s*["']?write\b/.test(l))
  )
    found.push("a workflow-level id-token or packages write");
  if (file !== "publish-images.yml") return found;
  if (lines.some((l) => /\bpull_request\b/.test(l))) found.push("publish-images.yml has a pull_request trigger");
  if (lines.some((l) => CACHE.test(l))) found.push("publish-images.yml uses a cache");
  // P2.26m: `bump` may follow `publish`; bumpJobProblems holds its shape.
  if (!["publish", `publish,${BUMP_JOB}`].includes([...all.keys()].join()))
    found.push("publish-images.yml has a job other than publish and bump");
  return found;
}

/**
 * The one workflow that may use workflow_run and a merge token (P0.07e; ADR 0034). It runs from the
 * default branch and must not check out pull request code. Every other file keeps the P0.07 bans.
 */
const AUTO_MERGE_FILE = "docs-auto-merge.yml";
const AUTO_MERGE_RUN = "node scripts/guards/docs-auto-merge.ts";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template.
const CHECKOUT_REF = "ref: ${{ github.sha }}";

const SCOPES_JUDGED_ELSEWHERE = new Set(["id-token", "packages", "contents", "pull-requests", "issues"]);

function otherWriteProblems(line: string): string[] {
  const found: string[] = [];
  for (const match of line.matchAll(/([\w-]+)["']?\s*:\s*["']?write\b/g)) {
    if (!SCOPES_JUDGED_ELSEWHERE.has(match[1] ?? "")) found.push(`write permission: ${line.trim()}`);
  }
  return found;
}

function keepProblem(file: string, line: string, problem: string): boolean {
  return !(
    file === AUTO_MERGE_FILE &&
    problem === "banned trigger" &&
    /\bworkflow_run\b/.test(line) &&
    !/\bpull_request_target\b/.test(line)
  );
}

function isMergeWrite(line: string): boolean {
  return /(?:\bcontents|\bpull-requests)["']?\s*:\s*["']?write\b/.test(line);
}

/**
 * The one other job that may hold contents: write and pull-requests: write (P2.26m): `bump` in publish-images.yml,
 * which opens the lock-bump pull request after `publish` signed. It needs `publish`, runs only for a push to main,
 * holds exactly those two scopes, checks out the pushed commit without keeping credentials, uses no other action than
 * setup-node, reads nothing a pull request controls and runs one script. id-token, packages and caches are already
 * refused there by signingProblems; a secret other than GITHUB_TOKEN by the environment rule.
 */
const BUMP_FILE = "publish-images.yml";
const BUMP_JOB = "bump";
const BUMP_RUN = "node scripts/ci/lock-bump-pr.ts";

/**
 * The bump job, line for line as it was reviewed, comments dropped. Rules read line by line kept missing ways to
 * change what a job runs (see WAIVERS_SHA256 below), so the job is not judged by shape: it must be exactly these
 * lines. That refuses an environment, a container, job defaults, another env or with key, another step and a quoted
 * key alike. Any edit to the job, an action bump included, is therefore also an edit to this guard.
 */
const BUMP_JOB_LINES = [
  "    needs: publish",
  `    ${GATE_IF}`,
  "    runs-on: ubuntu-24.04",
  "    timeout-minutes: 5",
  "    permissions:",
  "      contents: write",
  "      pull-requests: write",
  "    steps:",
  "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 ",
  "        with:",
  "          persist-credentials: false",
  `          ${CHECKOUT_REF}`,
  "      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 ",
  "        with:",
  "          node-version-file: .nvmrc",
  "          package-manager-cache: false",
  "      - env:",
  "          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
  "          REPO: ${{ github.repository }}",
  "          COMMIT: ${{ github.sha }}",
  "          RUN_ATTEMPT: ${{ github.run_attempt }}",
  "          PUBLISHED_LOCK: ${{ needs.publish.outputs.lock }}",
  `        run: ${BUMP_RUN}`,
];
const BUMP_JOB_CHANGED = "bump job is not the reviewed job (update BUMP_JOB_LINES with the change)";

function bumpJobProblems(lines: string[]): string[] {
  const writes = lines.filter(isMergeWrite);
  const body = jobs(lines).get(BUMP_JOB);
  if (body === undefined) return writes.map((line) => `write permission: ${line.trim()}`);
  const found: string[] = [];
  if (body.filter(isMergeWrite).length !== writes.length) found.push("a merge write outside the bump job");
  const kept = body.filter((line) => line.trim() !== "");
  if (kept.join("\n") !== BUMP_JOB_LINES.join("\n")) found.push(BUMP_JOB_CHANGED);
  // Workflow-level defaults would set the shell the job's one command runs in.
  if (lines.some((line) => /^["']?defaults["']?\s*:/.test(line)))
    found.push("publish-images.yml sets workflow defaults");
  return found;
}

/** contents: write and pull-requests: write exist only on the auto-merge job, in the shape below, and on `bump`. */
function docsAutoMergeProblems(file: string, lines: string[]): string[] {
  const writes = lines.filter(isMergeWrite);
  if (file === BUMP_FILE) return bumpJobProblems(lines);
  if (file !== AUTO_MERGE_FILE) return writes.map((line) => `write permission: ${line.trim()}`);
  const found: string[] = [];
  const contents = writes.filter((line) => line.trim() === "contents: write").length;
  const pulls = writes.filter((line) => line.trim() === "pull-requests: write").length;
  if (contents !== 1 || pulls !== 1) found.push("docs auto-merge writes are not exactly contents and pull-requests");
  if (lines.filter((line) => line.trim() === "checks: read").length !== 1) {
    found.push("docs auto-merge job lacks checks: read");
  }
  if ([...jobs(lines).keys()].join() !== "auto-merge") found.push("docs auto-merge workflow has another job");
  if (!lines.some((line) => line.trim() === "workflow_run:")) found.push("docs auto-merge workflow lacks workflow_run");
  if (lines.filter((line) => line.trim() === 'workflows: ["docs-only.yml"]').length !== 1) {
    found.push("docs auto-merge workflow_run is not limited to docs-only.yml");
  }
  if (lines.filter((line) => line.trim() === "types: [completed]").length !== 1) {
    found.push("docs auto-merge workflow_run is not limited to completed");
  }
  if (lines.some((line) => /^ {2}pull_request(_target)?:\s*$/.test(line))) {
    found.push("docs auto-merge workflow has a pull request trigger");
  }
  const runs = runValues(lines).map((value) => value.trim());
  if (runs.length !== 1 || runs[0] !== AUTO_MERGE_RUN)
    found.push("docs auto-merge runs something other than its script");
  const checkoutAt = lines.flatMap((line, index) => (/uses:\s*actions\/checkout@/.test(line) ? [index] : []));
  if (checkoutAt.length !== 1) found.push("docs auto-merge checkout count is not 1");
  const at = checkoutAt[0];
  if (at !== undefined) {
    const block: string[] = [];
    for (const line of lines.slice(at + 1)) {
      if (line.trim() !== "" && indent(line) <= indent(lines[at] ?? "")) break;
      block.push(line.trim());
    }
    if (!block.includes("persist-credentials: false")) found.push("docs auto-merge checkout keeps credentials");
    if (!block.includes(CHECKOUT_REF)) found.push("docs auto-merge checkout ref is not github.sha");
  }
  for (const line of lines) {
    if (/download-artifact|upload-artifact|github\.event\.pull_request|refs\/pull\/|head\.sha/.test(line)) {
      found.push(`docs auto-merge workflow touches untrusted input: ${line.trim()}`);
    }
  }
  return found;
}

/**
 * The one job that may write issues (P1.38r): `notify` in waivers.yml, which tells the owner that the daily waiver
 * look failed. It holds that one permission, uses no action, checks out nothing and runs one script that only calls
 * `gh issue`. Rules read line by line kept missing ways to change what such a job runs (another command, a custom
 * shell, workflow defaults, a quoted key), so the guard does not judge the file's shape: waivers.yml must be byte
 * for byte the file that was reviewed, named here by its SHA-256. Any edit to that workflow is therefore also an
 * edit to this guard. Every other file keeps the ban on write permissions.
 */
const WAIVERS_FILE = "waivers.yml";
const WAIVERS_SHA256 = "3461b5a2943ed81220c40d8ac3de1b916fa53626e3a6c2e91e158ea39586e945";

function waiverNotifyProblems(file: string, text: string, lines: string[]): string[] {
  const writes = lines.filter((line) => /\bissues["']?\s*:\s*["']?write\b/.test(line));
  if (file !== WAIVERS_FILE) return writes.map((line) => `write permission: ${line.trim()}`);
  const digest = createHash("sha256").update(text).digest("hex");
  return digest === WAIVERS_SHA256
    ? []
    : ["waivers.yml is not the reviewed file (update WAIVERS_SHA256 with the change)"];
}

/** Every rule violation in one workflow file (`file` is its name under .github/workflows/), as readable strings. */
export function problems(text: string, file = ""): string[] {
  const lines = code(text);
  const found = lines.flatMap((line, i) =>
    lineProblems(line)
      .filter((problem) => keepProblem(file, line, problem))
      .filter((problem) => problem !== UNPINNED_RUN || !isPushedDigestPull(file, lines, i))
      .map((problem) => `line ${i + 1}: ${problem}`),
  );
  if (!lines.some((l) => /^permissions:\s*\{\s*\}\s*$/.test(l))) found.push("top-level permissions is not {}");
  for (const value of runValues(lines)) if (value.includes("${{")) found.push(`expression inside run: ${value.trim()}`);
  for (const [id, body] of jobs(lines)) {
    if (ungated(body)) found.push(`job ${id}: secret or OIDC outside an environment-bound main-only job`);
  }
  found.push(...docsAutoMergeProblems(file, lines));
  found.push(...waiverNotifyProblems(file, text, lines));
  found.push(...signingProblems(file, lines));
  return found;
}
