// The no-product-imports-tooling-set rule in scripts/lint/.dependency-cruiser.cjs, on throwaway fixture trees (P1.28p).
// Its own file because depcruise.test.ts is already past the lines-per-file budget.
import { afterAll, expect, test } from "vitest";
import { check, config, cruiseFixture, edge, removeFixtures } from "./depcruise-fixture.ts";

afterAll(removeFixtures);

const RULE = "no-product-imports-tooling-set";

test("product_never_imports_the_tooling_set", async () => {
  // Step book 2026-10-08-p128p-product-never-imports-tooling.md: the gap was shared/http/via.ts importing a sibling
  // test helper, which the specifier check passes (its importer is a test) and the shared MATRIX row allows.
  for (const e of [
    edge("shared/http/via.ts", "./helper.test.ts"),
    edge("shared/http/via.ts", "./helper.test.ts", "type"),
    edge("shared/http/via.ts", "./helper.test.ts", "dynamic"),
    edge("domains/identity/a.ts", "../../tests/support/x.ts"),
    edge("shared/http/a.ts", "./fixtures/b.ts"),
    edge("shared/http/a.ts", "./__fixtures__/b.ts"),
    edge("shared/http/a.ts", "./b.fixture.ts"),
    edge("shared/http/a.ts", "./b.vector.json"),
    edge("scripts/ui/css-scope.ts", "../lint/depcruise-fixture.ts"),
    edge("scripts/ui/css-scope.ts", "./css-scope.test.ts"),
  ]) {
    const { exitCode, rules } = await check([e]);
    expect(exitCode, `${e.from} → ${e.spec}`).toBe(1);
    expect(rules, `${e.from} → ${e.spec}`).toContain(RULE);
  }
});

test("tooling_may_import_product_and_tooling", async () => {
  const alone = { forbidden: config.forbidden.filter((r) => (r as { name: string }).name === RULE) };
  expect(alone.forbidden).toHaveLength(1);
  for (const e of [
    edge("shared/http/via.test.ts", "./via.ts"),
    edge("shared/http/via.test.ts", "./helper.test.ts"),
    edge("shared/http/via.test.ts", "./fixtures/b.ts"),
    edge("tests/integration/a.test.ts", "../../shared/http/index.ts"),
    edge("scripts/lint/a.ts", "../ui/css-scope.ts"),
    edge("shared/http/fixtures/a.ts", "../b.vector.json"),
  ]) {
    expect(await cruiseFixture([e], alone), `${e.from} → ${e.spec}`).toEqual({ exitCode: 0, rules: [] });
  }
});
