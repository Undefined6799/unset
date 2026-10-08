// The edge-not-preflight rule in scripts/lint/.dependency-cruiser.cjs, checked on throwaway fixture trees (P1.28g).
// Its own file because depcruise.test.ts is already past the lines-per-file budget.
import { afterAll, expect, test } from "vitest";
import { check, config, cruiseFixture, edge, removeFixtures } from "./depcruise-fixture.ts";

afterAll(removeFixtures);

const RULE = "edge-not-preflight";

test("edge_never_imports_preflight", async () => {
  // Architecture record 2026-10-07-p130s-networks-and-caddyfile-reader.md, amendment 8, item 2: the edge is trusted
  // base and the preflight is product, so no edge file reaches the preflight. The tooling row lets any test import
  // anything, so the rule must bite on the edge's tests too.
  for (const e of [
    edge("deployment/edge/caddyfile.test.ts", "../preflight/compose-parse.ts"),
    edge("deployment/edge/caddyfile.test.ts", "../preflight/checks/b.ts", "type"),
    edge("deployment/edge/caddyfile.test.ts", "../preflight/index.ts", "dynamic"),
    edge("deployment/edge/caddyfile.ts", "../preflight/index.ts"),
  ]) {
    const { exitCode, rules } = await check([e]);
    expect(exitCode, `${e.from} → ${e.spec}`).toBe(1);
    expect(rules, `${e.from} → ${e.spec}`).toContain(RULE);
  }
  for (const e of [
    edge("deployment/edge/caddyfile.test.ts", "./caddyfile.ts"),
    edge("deployment/edge/caddyfile.test.ts", "node:fs"),
    edge("deployment/edge/caddyfile.test.ts", "vitest"),
    edge("deployment/edge/caddyfile.image.test.ts", "../../tests/integration/b.ts"),
  ]) {
    expect(await check([e]), `${e.from} → ${e.spec}`).toEqual({ exitCode: 0, rules: [] });
  }
});

test("edge_not_preflight_is_one_way", async () => {
  // The preflight reading the edge config (P1.30u's C18) is its matrix row's question, not this rule's: the rule
  // alone lets that edge through and refuses the reverse.
  const rule = config.forbidden.filter((r) => (r as { name: string }).name === RULE);
  expect(rule).toHaveLength(1);
  const alone = { forbidden: rule };
  const preflightToEdge = edge("deployment/preflight/checks/a.ts", "../../edge/caddyfile.ts");
  expect(await cruiseFixture([preflightToEdge], alone)).toEqual({ exitCode: 0, rules: [] });
  const edgeToPreflight = edge("deployment/edge/a.test.ts", "../preflight/b.ts");
  expect(await cruiseFixture([edgeToPreflight], alone)).toEqual({ exitCode: 1, rules: [RULE] });
});
