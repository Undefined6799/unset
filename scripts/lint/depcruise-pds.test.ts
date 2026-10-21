import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { afterAll, expect, test } from "vitest";
import { check, config, edge, outcome, RULES, removeFixtures, tempDir, write } from "./depcruise-fixture.ts";

afterAll(removeFixtures);

test("pds_presentation_imports_are_exact", async () => {
  for (const spec of [
    "./other.tsx",
    "./view.module.css",
    "../../../shared/ui/presentation.ts",
    "../../../shared/ui/components/Header/BrandHeader.tsx",
    "../../../shared/ui/src/tokens.css",
    "react",
    "react/jsx-runtime",
  ]) {
    expect(await check([edge("apps/pds/src/view.tsx", spec)]), spec).toEqual({ exitCode: 0, rules: [] });
  }
  expect(await check([edge("apps/pds/src/view.test.tsx", "vitest")])).toEqual({ exitCode: 0, rules: [] });
});

test("pds_rejects_every_nonpresentation_edge", async () => {
  for (const from of ["apps/pds/src/view.tsx", "apps/pds/vite.config.ts", "apps/pds/src/vite.config.ts"]) {
    const prefix = from === "apps/pds/vite.config.ts" ? "../../" : "../../../";
    for (const spec of [
      "shared/ui/index.ts",
      "shared/ui/components/Button/Button.tsx",
      "shared/ui/presentation.ts.bak.ts",
      "shared/ui/components/Header/Header.tsx",
      "shared/ui/components/Footer/Footer.module.css",
      "shared/islands/index.ts",
      "shared/http/index.ts",
      "shared/config/index.ts",
      "apps/web/render.tsx",
      "domains/identity/index.ts",
      "infrastructure/pds/index.ts",
      "scripts/ui/css-scope.ts",
      "tests/support/a.ts",
    ]) {
      expect((await check([edge(from, prefix + spec)])).exitCode, `${from} -> ${spec}`).toBe(1);
    }
    for (const spec of [
      "left-pad",
      "vitest",
      "vite",
      "@atproto/api",
      "react-dom/client",
      "react-dom/server",
      "react/jsx-dev-runtime",
      "react/server",
      "@tanstack/react-query",
      "react-router",
      "node:http",
    ]) {
      expect((await check([edge(from, spec)])).exitCode, `${from} -> ${spec}`).toBe(1);
    }
  }
  for (const from of ["apps/web/src/a.ts", "scripts/a.ts", "shared/http/a.ts"]) {
    const prefix = from.startsWith("apps/") ? "../../../" : from.startsWith("scripts/") ? "../" : "../../";
    expect((await check([edge(from, `${prefix}shared/ui/presentation.ts`)])).rules).toContain("infra-shared-via-index");
  }
  for (const kind of ["type", "dynamic"] as const) {
    expect((await check([edge("apps/pds/src/view.tsx", "../../../shared/http/index.ts", kind)])).exitCode).toBe(1);
  }
  expect((await check([edge("apps/pds/src/a.ts", "./a.test.ts")])).rules).toContain("no-product-imports-tooling-set");
});

test("pds_public_package_subpaths_resolve_to_reviewed_files", async () => {
  const root = tempDir();
  write(root, "package.json", JSON.stringify({ type: "module", dependencies: { "@unset/shared-ui": "*" } }));
  write(
    root,
    "shared/ui/package.json",
    JSON.stringify({
      name: "@unset/shared-ui",
      exports: {
        ".": "./index.ts",
        "./presentation": "./presentation.ts",
        "./brand-header": "./components/Header/BrandHeader.tsx",
      },
    }),
  );
  for (const file of ["index.ts", "presentation.ts", "components/Header/BrandHeader.tsx"])
    write(root, `shared/ui/${file}`, "export const view = 1;");
  write(root, "node_modules/@unset/.keep", "");
  symlinkSync("../../shared/ui", join(root, "node_modules/@unset/shared-ui"), "dir");
  write(
    root,
    "apps/pds/src/view.tsx",
    'export * from "@unset/shared-ui/presentation"; export * from "@unset/shared-ui/brand-header";',
  );
  const options: object = { ...config.options, baseDir: root, validate: true, ruleSet: RULES, outputType: "json" };
  const { output } = await cruise(["."], options);
  const result: ICruiseResult = JSON.parse(String(output));
  expect(outcome(result)).toEqual({ exitCode: 0, rules: [] });
  expect(
    result.modules
      .find((m) => m.source === "apps/pds/src/view.tsx")
      ?.dependencies.map((d) => d.resolved)
      .sort(),
  ).toEqual(["shared/ui/components/Header/BrandHeader.tsx", "shared/ui/presentation.ts"]);
});

test("pds_builder_leaf_allows_only_builtins_and_no_runtime_importers", async () => {
  for (const spec of ["node:fs", "node:path", "node:crypto"])
    expect(await check([edge("deployment/pds/build-ui.mjs", spec)])).toEqual({ exitCode: 0, rules: [] });
  for (const spec of ["../../scripts/ui/css-scope.ts", "./other.mjs", "react", "tar-stream"])
    expect((await check([edge("deployment/pds/build-ui.mjs", spec)])).exitCode).toBe(1);
  for (const from of [
    "deployment/pds/other.mjs",
    "apps/web/loader.ts",
    "interfaces/http/loader.ts",
    "shared/ui/loader.ts",
  ]) {
    expect((await check([edge(from, "../../deployment/pds/build-ui.mjs")])).exitCode).toBe(1);
  }
  expect((await check([edge("deployment/pds/build-other.mjs", "node:fs")])).exitCode).toBe(1);
});
