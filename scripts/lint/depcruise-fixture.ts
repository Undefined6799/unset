// Fixture trees for depcruise.test.ts: each edge becomes a file importing a target that exists.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise, type ICruiseResult } from "dependency-cruiser";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG_PATH = join(ROOT, "scripts/lint/.dependency-cruiser.cjs");
export const DEPCRUISE = join(ROOT, "node_modules", ".bin", "depcruise");

export type Row = { name: string; from: object; to: object[] };
type Config = {
  allowed: object[];
  allowedSeverity: string;
  forbidden: object[];
  options: object;
  MATRIX: Row[];
  ZERO_DEP_ALLOWLIST: string[];
  RENDER_ENTRIES: { http: string; admin: string };
  RENDER_BUILD_IMPORT: { from: string; module: string };
  E2E_SERVER_BUILD: { from: string; module: string };
  LEXICON_SCRIPT_BUILTINS: string[];
};
export const config: Config = createRequire(import.meta.url)(CONFIG_PATH);

/**
 * One import in a fixture: `from` (repo-relative) imports `spec`, statically unless `kind` says otherwise. An
 * `unresolved` specifier gets no target: no stub package for a bare one, no file for a relative one, so
 * dependency-cruiser cannot resolve it.
 */
export type Edge = {
  from: string;
  spec: string;
  kind?: "type" | "dynamic";
  unresolved?: true;
  /** Package `main`, when a bare specifier must resolve under that file (yaml's is `dist/index.js`). */
  packageEntry?: string;
};
export type Outcome = { exitCode: number; rules: string[] };

const temps: string[] = [];
export function removeFixtures(): void {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "depcruise-"));
  temps.push(dir);
  return dir;
}

export function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text, { flag: "a" });
}

function importLine({ spec, kind }: Edge, n: number): string {
  if (kind === "type") return `import type { T${n} } from "${spec}";\n`;
  if (kind === "dynamic") return `export const d${n} = await import("${spec}");\n`;
  return `import * as m${n} from "${spec}";\nexport { m${n} };\n`;
}

/** The file a relative edge imports, repo-relative; undefined for a bare, `node:` or unresolved one. */
export function target(edge: Edge): string | undefined {
  return edge.spec.startsWith(".") && !edge.unresolved ? posix.join(posix.dirname(edge.from), edge.spec) : undefined;
}

/**
 * Writes the importing files, every relative target once, and a stub package for every bare specifier. Edges from
 * one file become separate imports in it.
 */
export function fixture(edges: Edge[]): string {
  const root = tempDir();
  const targets = new Set<string>();
  const packages = new Map<string, string>();
  edges.forEach((edge, n) => {
    write(root, edge.from, importLine(edge, n));
    if (edge.unresolved) return;
    const file = target(edge);
    if (file) {
      if (!targets.has(file)) write(root, file, "export const x = 1;\n");
      targets.add(file);
    } else if (!edge.spec.startsWith("node:")) {
      packages.set(edge.spec, edge.packageEntry ?? packages.get(edge.spec) ?? "index.js");
    }
  });
  for (const [name, entry] of packages) {
    write(
      root,
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, main: entry, exports: { ".": `./${entry}` } }),
    );
    write(root, `node_modules/${name}/${entry}`, "module.exports = {};\n");
  }
  // A subpath specifier (react/jsx-runtime) is declared by its package name, as a real package.json would.
  const packageName = (spec: string) =>
    spec
      .split("/")
      .slice(0, spec.startsWith("@") ? 2 : 1)
      .join("/");
  const dependencies = Object.fromEntries([...packages.keys()].map((name) => [packageName(name), "1.0.0"]));
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true, dependencies }));
  return root;
}

export async function cruiseResult(edges: Edge[], ruleSet: object): Promise<ICruiseResult> {
  const root = fixture(edges);
  const { output } = await cruise(["."], {
    ...config.options,
    baseDir: root,
    validate: true,
    ruleSet,
    outputType: "json",
  });
  return JSON.parse(String(output));
}

export function outcome(result: ICruiseResult): Outcome {
  const rules = result.summary.violations.filter((v) => v.rule.severity === "error").map((v) => v.rule.name);
  // The API reports exit 0 for the json reporter; the CLI's err reporter exits with the error count.
  return { exitCode: result.summary.error > 0 ? 1 : 0, rules };
}

export async function cruiseFixture(edges: Edge[], ruleSet: object): Promise<Outcome> {
  return outcome(await cruiseResult(edges, ruleSet));
}

export const RULES = { allowed: config.allowed, allowedSeverity: config.allowedSeverity, forbidden: config.forbidden };
export const check = (edges: Edge[]): Promise<Outcome> => cruiseFixture(edges, RULES);
export const edge = (from: string, spec: string, kind?: Edge["kind"]): Edge =>
  kind ? { from, spec, kind } : { from, spec };
