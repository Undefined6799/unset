// The specifier-must-resolve rule in scripts/lint/.dependency-cruiser.cjs, checked on throwaway fixture trees (P1.28k).
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { afterAll, expect, test } from "vitest";
import { check, config, type Edge, edge, fixture, removeFixtures, write } from "./depcruise-fixture.ts";

afterAll(removeFixtures);

const RULE = "specifier-must-resolve";
const unresolved = (from: string, spec: string): Edge => ({ from, spec, unresolved: true });

async function expectRefused(...edges: Edge[]): Promise<void> {
  for (const e of edges) {
    const { exitCode, rules } = await check([e]);
    expect(exitCode, `${e.from} → ${e.spec}`).toBe(1);
    expect(rules, `${e.from} → ${e.spec}`).toContain(RULE);
  }
}

test("root_absolute_and_unresolved_imports_fail", async () => {
  // Architecture amendment 8, second note (2026-10-08 01:10Z): depcruise leaves "/deployment/preflight/…" unresolved
  // with its slash, so no path rule matches it, while Vitest resolves it from the repo root.
  await expectRefused(
    unresolved("deployment/edge/caddyfile.test.ts", "/deployment/preflight/compose-parse.ts"),
    unresolved("deployment/edge/caddyfile.test.ts", "file:///deployment/preflight/compose-parse.ts"),
    unresolved("apps/web/src/a.ts", "./missing.ts"),
    unresolved("domains/identity/a.ts", "../content/missing.ts"),
    unresolved("interfaces/http/a.ts", "@unset/x"),
  );
});

test("render_build_import_is_the_only_unresolved_exception", async () => {
  // The exception is RENDER_BUILD_IMPORT itself, read from the config, so there is no second copy to drift.
  const { from, module } = config.RENDER_BUILD_IMPORT;
  expect(await check([{ ...unresolved(from, module) }])).toEqual({ exitCode: 0, rules: [] });
  await expectRefused(
    unresolved("interfaces/http/web/page.ts", module),
    unresolved(from, "@unset/apps-web/other"),
    unresolved(from, "./missing.ts"),
  );
});

test("resolved_imports_and_bare_packages_pass", async () => {
  // Only our own specifiers must resolve; a bare third-party package that is not installed is not ours to judge here.
  for (const e of [edge("apps/web/src/a.ts", "./b.ts"), edge("interfaces/http/a.ts", "node:http")]) {
    expect(await check([e]), `${e.from} → ${e.spec}`).toEqual({ exitCode: 0, rules: [] });
  }
  const { rules } = await check([unresolved("tests/integration/a.test.ts", "left-pad")]);
  expect(rules).not.toContain(RULE);
});

test("absolute_path_that_resolves_meets_the_path_rules", async () => {
  // An absolute path depcruise can resolve comes back repo-relative, so the folder rules judge it like any import.
  const root = fixture([edge("deployment/preflight/b.ts", "./c.ts")]);
  write(root, "deployment/edge/a.test.ts", `import { x } from "${root}/deployment/preflight/c.ts";\nexport { x };\n`);
  const ruleSet: object = {
    allowed: config.allowed,
    allowedSeverity: config.allowedSeverity,
    forbidden: config.forbidden,
  };
  const { output } = await cruise(["."], {
    ...config.options,
    baseDir: root,
    validate: true,
    ruleSet,
    outputType: "json",
  });
  const result: ICruiseResult = JSON.parse(String(output));
  const names = result.summary.violations.filter((v) => v.from === "deployment/edge/a.test.ts").map((v) => v.rule.name);
  expect(names).toContain("edge-not-preflight");
});
