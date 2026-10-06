// A trusted package born in a trusted-base PR (P1.14q; architecture ruling 2026-10-06 19:50Z, point 3 and the 19:50Z
// amendment): the root tsconfig.json may ride only when it adds that package's reference and nothing else, and the
// lockfile may carry the package's own workspace and link entries.
import { describe, expect, test } from "vitest";
import { checkTrustedBaseIsolation, type DocFacts } from "./trusted-base.ts";

const PATTERNS = ["/shared/http/", "/infrastructure/seal/"];
const SEAL = "infrastructure/seal";
const MANIFEST = `${SEAL}/package.json`;
const NAME = "@unset/infrastructure-seal";
const TSCONFIG = "tsconfig.json";
const LOCK = "package-lock.json";
const SOURCES = [MANIFEST, `${SEAL}/index.ts`, `${SEAL}/index.test.ts`];

const tsconfig = (paths: string[], extra: object = {}) => ({
  files: [],
  references: paths.map((path) => ({ path })),
  ...extra,
});
const BASE_TSCONFIG = tsconfig(["domains/identity", "shared/http"]);

const BASE_PACKAGES = {
  "": { name: "unset.sh", workspaces: ["infrastructure/*", "shared/*", "domains/*"] },
  "shared/http": { name: "@unset/shared-http", version: "0.0.0" },
  "node_modules/@unset/shared-http": { resolved: "shared/http", link: true },
  "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
};
const OWN_ENTRIES = {
  [SEAL]: { name: NAME, version: "0.0.0" },
  [`node_modules/${NAME}`]: { resolved: SEAL, link: true },
};
const lock = (packages: object) => ({ lockfileVersion: 3, packages });

type Case = { paths?: string[]; head?: object; manifests?: [string, string][]; packages?: object };
/** A PR adding the seal package with the given root tsconfig.json head, added manifests and lockfile head. */
function isolate({ paths = [...SOURCES, TSCONFIG], head, manifests, packages }: Case) {
  const docs: DocFacts = {
    regular: new Set(paths),
    licenceOnly: new Set(),
    dependencyChanges: new Set(),
    lockfiles: packages === undefined ? null : { base: lock(BASE_PACKAGES), head: lock(packages) },
    addedManifests: new Map(manifests ?? [[MANIFEST, NAME]]),
    rootTsconfig: { base: BASE_TSCONFIG, head: head ?? tsconfig(["domains/identity", SEAL, "shared/http"]) },
  };
  return checkTrustedBaseIsolation(paths, PATTERNS, { parsedPaths: [], findings: [], docs });
}

describe("a new trusted workspace", () => {
  test("new_trusted_workspace_reference_rides", () => {
    expect(isolate({})).toEqual({ ok: true, touched: true });
    // Appended at the end works the same as in sorted order.
    expect(isolate({ head: tsconfig(["domains/identity", "shared/http", SEAL]) })).toEqual({ ok: true, touched: true });
  });

  test("reference_to_existing_workspace_fails", () => {
    // shared/http's manifest is not added in this PR, so its (duplicate) reference is not "born here".
    const head = tsconfig(["domains/identity", SEAL, "shared/http", "shared/http"]);
    expect(isolate({ head })).toEqual({ ok: false, outside: [TSCONFIG] });
    // Without the package's manifest in the PR at all, the reference is not born here either.
    expect(isolate({ paths: [`${SEAL}/index.ts`, TSCONFIG], manifests: [] })).toEqual({
      ok: false,
      outside: [TSCONFIG],
    });
  });

  test("reference_to_new_untrusted_folder_fails", () => {
    const head = tsconfig(["domains/identity", "domains/content", SEAL, "shared/http"]);
    const paths = [...SOURCES, "domains/content/package.json", TSCONFIG];
    const manifests: [string, string][] = [
      [MANIFEST, NAME],
      ["domains/content/package.json", "@unset/domains-content"],
    ];
    expect(isolate({ paths, head, manifests })).toEqual({
      ok: false,
      outside: ["domains/content/package.json", TSCONFIG],
    });
  });

  test("reference_with_compiler_options_fails", () => {
    const head = tsconfig(["domains/identity", SEAL, "shared/http"], { compilerOptions: { strict: false } });
    expect(isolate({ head })).toEqual({ ok: false, outside: [TSCONFIG] });
  });

  test("removed_reference_fails", () => {
    expect(isolate({ head: tsconfig([SEAL, "shared/http"]) })).toEqual({ ok: false, outside: [TSCONFIG] });
    // Reordering the existing references is a change too.
    expect(isolate({ head: tsconfig(["shared/http", SEAL, "domains/identity"]) })).toEqual({
      ok: false,
      outside: [TSCONFIG],
    });
  });

  test("new_workspace_own_lockfile_entries_ride", () => {
    const paths = [...SOURCES, TSCONFIG, LOCK];
    expect(isolate({ paths, packages: { ...BASE_PACKAGES, ...OWN_ENTRIES } })).toEqual({ ok: true, touched: true });
  });

  test("new_workspace_with_third_party_entry_fails", () => {
    const paths = [...SOURCES, TSCONFIG, LOCK];
    const packages = { ...BASE_PACKAGES, ...OWN_ENTRIES, "node_modules/b": { version: "2.0.0" } };
    expect(isolate({ paths, packages })).toEqual({ ok: false, outside: [`${LOCK} (node_modules/b (b@2.0.0))`] });
  });

  test("new_workspace_link_elsewhere_fails", () => {
    const paths = [...SOURCES, TSCONFIG, LOCK];
    const link = `node_modules/${NAME}`;
    const packages = { ...BASE_PACKAGES, ...OWN_ENTRIES, [link]: { resolved: "domains/content", link: true } };
    expect(isolate({ paths, packages })).toEqual({ ok: false, outside: [`${LOCK} (${link} (${NAME}@?))`] });
  });
});
