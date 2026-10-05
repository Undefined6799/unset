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
};
export const config: Config = createRequire(import.meta.url)(CONFIG_PATH);

/** One import in a fixture: `from` (repo-relative) imports `spec`, statically unless `kind` says otherwise. */
export type Edge = { from: string; spec: string; kind?: "type" | "dynamic" };
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

/** Writes the importing files, every relative target, and a stub package for every bare specifier. */
export function fixture(edges: Edge[]): string {
  const root = tempDir();
  const packages = new Set<string>();
  edges.forEach((edge, n) => {
    write(root, edge.from, importLine(edge, n));
    if (edge.spec.startsWith(".")) {
      write(root, posix.join(posix.dirname(edge.from), edge.spec), "export const x = 1;\n");
    } else if (!edge.spec.startsWith("node:")) {
      packages.add(edge.spec);
    }
  });
  for (const name of packages) {
    write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, main: "index.js" }));
    write(root, `node_modules/${name}/index.js`, "module.exports = {};\n");
  }
  const dependencies = Object.fromEntries([...packages].map((name) => [name, "1.0.0"]));
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true, dependencies }));
  return root;
}

export async function cruiseFixture(edges: Edge[], ruleSet: object): Promise<Outcome> {
  const root = fixture(edges);
  const { output } = await cruise(["."], {
    ...config.options,
    baseDir: root,
    validate: true,
    ruleSet,
    outputType: "json",
  });
  const result: ICruiseResult = JSON.parse(String(output));
  const rules = result.summary.violations.filter((v) => v.rule.severity === "error").map((v) => v.rule.name);
  // The API reports exit 0 for the json reporter; the CLI's err reporter exits with the error count.
  return { exitCode: result.summary.error > 0 ? 1 : 0, rules };
}

const RULES = { allowed: config.allowed, allowedSeverity: config.allowedSeverity, forbidden: config.forbidden };
export const check = (edges: Edge[]): Promise<Outcome> => cruiseFixture(edges, RULES);
export const edge = (from: string, spec: string, kind?: Edge["kind"]): Edge =>
  kind ? { from, spec, kind } : { from, spec };
