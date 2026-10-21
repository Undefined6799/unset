// The CI supply-chain and privilege rules (P0.07) over one workflow file.
// Line-based on purpose: the rules are about what the YAML says, and a parser would be one more dependency.

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

/** Pinning, trigger and permission problems visible on one line. */
function lineProblems(line: string): string[] {
  const found: string[] = [];
  const uses = /\buses["']?:\s*["']?([^\s"']+)/.exec(line)?.[1];
  if (uses && !uses.startsWith("./") && !/^actions\/[\w.-]+@[0-9a-f]{40}$/.test(uses)) {
    found.push(`action not GitHub-owned and SHA-pinned: ${uses}`);
  }
  // github-script runs its `script:` input as code, out of reach of the no-expression-in-run rule.
  if (uses?.startsWith("actions/github-script@")) found.push("actions/github-script is not allowed");
  const image = /(?:\b\w*_IMAGE|\bimage|\bcontainer):\s*["']?([^\s"'{]+)/.exec(line)?.[1];
  if (image && !/@sha256:[0-9a-f]{64}$/.test(image)) found.push(`image not pinned by digest: ${image}`);
  if (/\b(?:docker|podman)\s+(?:container\s+|image\s+)?(?:run|create|pull)\b/.test(line)) {
    if (!/"\$\w+_IMAGE"|@sha256:[0-9a-f]{64}/.test(line)) found.push("container started without a digest-pinned image");
  }
  // A BuildKit container builder runs an image too (P1.27s): it names one by digest, or through a pinned variable.
  // buildx keeps the last `image=` among its driver options, so the line carries exactly one, ending at its value.
  const builderImage = /(?:^|[\s",])image=(?:\$\w+_IMAGE"|[^\s",]+@sha256:[0-9a-f]{64}(?=["\s]|$))/;
  if (/\bbuildx\s+create\b/.test(line) && (line.split("image=").length !== 2 || !builderImage.test(line))) {
    found.push("BuildKit builder without a digest-pinned image");
  }
  // An image variable may only come from the workflow text, where the digest check above can see it.
  if (/_IMAGE=/.test(line) && /\bGITHUB_ENV\b/.test(line)) found.push("image variable written at run time");
  if (/\b(pull_request_target|workflow_run)\b/.test(line)) found.push("banned trigger");
  // id-token and packages are judged per job by signingProblems; every other write scope is refused here.
  for (const m of line.matchAll(/([\w-]+)["']?\s*:\s*["']?write\b/g)) {
    if (m[1] !== "id-token" && m[1] !== "packages") found.push(`write permission: ${line.trim()}`);
  }
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
  return found;
}

/** The signing rules over one file: per job, plus publish-images.yml's own shape (push or dispatch, one job). */
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
  if ([...all.keys()].join() !== "publish") found.push("publish-images.yml has a job other than publish");
  return found;
}

/** Every rule violation in one workflow file (`file` is its name under .github/workflows/), as readable strings. */
export function problems(text: string, file = ""): string[] {
  const lines = code(text);
  const found = lines.flatMap((line, i) => lineProblems(line).map((p) => `line ${i + 1}: ${p}`));
  if (!lines.some((l) => /^permissions:\s*\{\s*\}\s*$/.test(l))) found.push("top-level permissions is not {}");
  for (const value of runValues(lines)) if (value.includes("${{")) found.push(`expression inside run: ${value.trim()}`);
  for (const [id, body] of jobs(lines)) {
    if (ungated(body)) found.push(`job ${id}: secret or OIDC outside an environment-bound main-only job`);
  }
  found.push(...signingProblems(file, lines));
  return found;
}
