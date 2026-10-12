// Lists every Dockerfile the images workflow scans (P1.29w). Discovery is images.test.ts's
// rule (deployment/images/images.test.ts): readdir of deployment/, recursive, keeping paths
// that match /(^|\/)([\w.-]+\.)?Dockerfile$/ and dropping anything under node_modules.
// Node v26.10.0 fs.readdirSync recursive (nodejs.org/docs/latest-v26.x/api/fs.html, the
// readdirSync options; recursive added in v20.1.0 / v18.17.0) lists the names under
// deployment/. realpathSync then refuses a path that resolves outside that directory.
//
// Ignore files are this map, never "a <name>.trivyignore beside the Dockerfile". P1.29v
// emptied it, so every shipped image is scanned in full. A later entry is a loosening and
// needs Alex's card and line.
//
// The CLI appends one `images=` line to $GITHUB_OUTPUT (GitHub Actions workflow commands:
// docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands, "Setting an
// output parameter"). Node 26.10.0 runs this file directly (type stripping; .nvmrc, and
// pr-shape.yml's `node scripts/guards/change-shape.ts`).
import { appendFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..", "..");
/** Same filter as deployment/images/images.test.ts. A copy, so the test can tell them apart. */
const DOCKERFILE = /(^|\/)([\w.-]+\.)?Dockerfile$/;
const NAME = /^[a-z0-9-]+$/;

/** Images whose scan reads an ignore file: none. Every image gets /dev/null. */
export const IGNOREFILES: Readonly<Record<string, string>> = {};

export type ListedImage = { name: string; dockerfile: string; ignorefile: string };

/** Repo-relative Dockerfile paths under deployment/, in images.test.ts's discovery order. */
export function discoverDockerfiles(root: string): string[] {
  const deployment = join(root, "deployment");
  if (!existsSync(deployment)) return [];
  return readdirSync(deployment, { encoding: "utf8", recursive: true })
    .map((entry) => entry.split(sep).join("/"))
    .filter((rel) => DOCKERFILE.test(rel) && !rel.includes("node_modules"))
    .map((rel) => `deployment/${rel}`)
    .sort();
}

/** The image name: the parent directory when the file is `Dockerfile`, otherwise the stem. */
export function imageName(dockerfile: string): string {
  const base = dockerfile.slice(dockerfile.lastIndexOf("/") + 1);
  if (base === "Dockerfile") {
    const parent = dockerfile.slice(0, dockerfile.lastIndexOf("/"));
    return parent.slice(parent.lastIndexOf("/") + 1);
  }
  const suffix = ".Dockerfile";
  return base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Why one repo-relative path must not be scanned. Empty means it may. */
export function entryProblems(root: string, dockerfile: string): string[] {
  if (
    dockerfile.startsWith("/") ||
    dockerfile.includes("\\") ||
    dockerfile.split("/").includes("..") ||
    !dockerfile.startsWith("deployment/")
  ) {
    return [`path outside deployment/: ${dockerfile}`];
  }
  const deployment = join(root, "deployment");
  if (!existsSync(deployment) || !existsSync(join(root, dockerfile))) {
    return [`path outside deployment/: ${dockerfile}`];
  }
  const real = realpathSync(join(root, dockerfile));
  if (!inside(realpathSync(deployment), real)) return [`path outside deployment/: ${dockerfile}`];
  const name = imageName(dockerfile);
  if (!NAME.test(name)) return [`name does not match ${NAME}: ${name} (${dockerfile})`];
  return [];
}

/**
 * One entry per discovered Dockerfile. Throws on an empty list, a bad name, a path outside
 * deployment/, or two Dockerfiles that would share a matrix name.
 */
export function listDockerfiles(root: string): ListedImage[] {
  const paths = discoverDockerfiles(root);
  if (paths.length === 0) throw new Error("no Dockerfiles under deployment/");
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const listed: ListedImage[] = [];
  for (const dockerfile of paths) {
    problems.push(...entryProblems(root, dockerfile));
    const name = imageName(dockerfile);
    const prior = seen.get(name);
    if (prior !== undefined) problems.push(`duplicate image name ${name}: ${prior} and ${dockerfile}`);
    else seen.set(name, dockerfile);
    const ignorefile = Object.hasOwn(IGNOREFILES, name) ? IGNOREFILES[name] : "/dev/null";
    if (ignorefile === undefined) problems.push(`ignore file missing for ${name}`);
    else listed.push({ name, dockerfile, ignorefile });
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return listed;
}

/** Appends the `images` job output. Fails closed when Actions did not set GITHUB_OUTPUT. */
export function publishImages(images: readonly ListedImage[], outputFile: string | undefined): void {
  if (outputFile === undefined || outputFile === "") throw new Error("GITHUB_OUTPUT is unset");
  appendFileSync(outputFile, `images=${JSON.stringify(images)}\n`);
}

function main(): void {
  const root = process.argv[2] ?? ROOT;
  publishImages(listDockerfiles(root), process.env.GITHUB_OUTPUT);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
