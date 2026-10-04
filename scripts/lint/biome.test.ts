// The Biome rules switched on in P0.05, each shown biting on a known-bad fixture.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");
const config = JSON.parse(readFileSync(join(ROOT, "biome.json"), "utf8"));

type Diagnostic = { severity: string; category: string };
type Outcome = { exitCode: number | null; diagnostics: Diagnostic[] };

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Runs `biome ci` with the repo's rules on one fixture file; formatting is off so only lint speaks. */
function biome(file: string, text: string): Outcome {
  const root = mkdtempSync(join(tmpdir(), "biome-"));
  temps.push(root);
  const { vcs: _vcs, $schema: _schema, ...rules } = config;
  writeFileSync(join(root, "biome.json"), JSON.stringify(rules));
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
  const run = spawnSync(BIOME, ["ci", "--formatter-enabled=false", "--colors=off", "--reporter=json", file], {
    cwd: root,
    encoding: "utf8",
  });
  const json = run.stdout.slice(run.stdout.indexOf("{"));
  return { exitCode: run.status, diagnostics: JSON.parse(json).diagnostics };
}

const categories = (o: Outcome): string[] => o.diagnostics.map((d) => `${d.severity} ${d.category}`);

/** One known-bad fixture per rule switched on (findings F-19). */
const BITES: [rule: string, level: "error" | "warning", file: string, text: string][] = [
  ["style/noHexColors", "error", "apps/web/x.module.css", ".a {\n  color: #fff;\n}\n"],
  ["correctness/noMissingVarFunction", "error", "apps/web/x.module.css", ".a {\n  --c: red;\n  color: --c;\n}\n"],
  ["complexity/noImportantStyles", "error", "apps/web/x.module.css", ".a {\n  color: var(--c) !important;\n}\n"],
  ["style/useConst", "error", "domains/x/a.ts", "let a = 1;\nexport const b = a;\n"],
  ["style/noParameterAssign", "error", "domains/x/a.ts", "export function f(x: number) {\n  x = 2;\n  return x;\n}\n"],
  ["suspicious/noEmptyBlockStatements", "error", "domains/x/a.ts", "export function f(): void {}\n"],
  ["suspicious/noConsole", "error", "domains/x/a.ts", 'console.log("x");\n'],
  ["suspicious/noFocusedTests", "error", "domains/x/a.test.ts", 'test.only("x", () => {\n  run();\n});\n'],
  ["suspicious/noSkippedTests", "error", "domains/x/a.test.ts", 'test.skip("x", () => {\n  run();\n});\n'],
  [
    "complexity/noExcessiveCognitiveComplexity",
    "warning",
    "domains/x/a.ts",
    `export function f(a: number[]): number {
  let n = 0;
  for (const x of a) {
    if (x > 1) {
      for (const y of a) {
        if (y > x && x !== 3) {
          while (n < y) {
            if (n % 2 === 0 || y === 4) n += 1;
            else if (n % 3 === 0) n += 2;
            else n += 3;
          }
        }
      }
    }
  }
  return n;
}
`,
  ],
  [
    "style/noExcessiveLinesPerFile",
    "warning",
    "domains/x/a.ts",
    Array.from({ length: 301 }, (_, i) => `export const v${i} = ${i};`).join("\n"),
  ],
];

describe("biome", () => {
  test("biome_rejects_hex_in_css", () => {
    const out = biome("apps/web/x.module.css", ".a {\n  color: #fff;\n}\n");
    expect(out.exitCode).not.toBe(0);
    expect(categories(out)).toContain("error lint/style/noHexColors");
  });

  test("biome_allows_hex_in_tokens", () => {
    const out = biome("shared/ui/src/tokens.css", ":root {\n  --c: #fff;\n}\n");
    expect(out).toEqual({ exitCode: 0, diagnostics: [] });
  });

  test("biome_allows_long_generated_files", () => {
    const text = Array.from({ length: 301 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    expect(biome("shared/lexicons/types.generated.ts", text)).toEqual({ exitCode: 0, diagnostics: [] });
  });

  test("biome_cognitive_complexity_warns", () => {
    const [, , file, text] = BITES.find(([rule]) => rule === "complexity/noExcessiveCognitiveComplexity") ?? [];
    const out = biome(file ?? "", text ?? "");
    expect(out.exitCode).toBe(0);
    expect(categories(out)).toEqual(["warning lint/complexity/noExcessiveCognitiveComplexity"]);
  });

  test.each(BITES)("biome_rules_bite %s", (rule, level, file, text) => {
    const out = biome(file, text);
    expect(categories(out)).toContain(`${level} lint/${rule}`);
    if (level === "error") expect(out.exitCode).not.toBe(0);
  });

  test("biome_rule_names_exist", () => {
    const schema = JSON.parse(
      readFileSync(join(ROOT, "node_modules", "@biomejs", "biome", "configuration_schema.json"), "utf8"),
    );
    const groups = (rules: Record<string, unknown>): [string, string][] =>
      Object.entries(rules)
        .filter(([group]) => group !== "preset")
        .flatMap(([group, set]) => Object.keys(set as object).map((rule): [string, string] => [group, rule]));
    const used = [
      ...groups(config.linter.rules),
      ...config.overrides.flatMap((o: { linter?: { rules?: object } }) =>
        groups((o.linter?.rules ?? {}) as Record<string, unknown>),
      ),
    ];
    expect(used.length).toBeGreaterThan(0);
    for (const [group, rule] of used) {
      const def = schema.$defs[group[0].toUpperCase() + group.slice(1)];
      expect(def?.properties?.[rule], `${group}/${rule}`).toBeDefined();
    }
  });
});
