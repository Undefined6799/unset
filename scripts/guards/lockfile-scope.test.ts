// Ruling 2026-10-05 02:50Z, per-entry part: in a trusted-base PR every lockfile entry the PR adds, changes or moves is
// the trusted package's own workspace entry or in its dependency closure (by name and version), else it fails closed.
import { describe, expect, test } from "vitest";
import { lockfileStrays } from "./lockfile-scope.ts";
import { checkTrustedBaseIsolation, type DocFacts } from "./trusted-base.ts";

type Packages = Record<string, Record<string, unknown>>;
const lock = (packages: Packages) => ({ name: "unset.sh", lockfileVersion: 3, packages });
const pkg = (version: string, dependencies?: Record<string, string>) => ({
  version,
  resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
  integrity: `sha512-${version}`,
  ...(dependencies ? { dependencies } : {}),
});
const BASE: Packages = {
  "": { name: "unset.sh", workspaces: ["shared/*", "domains/*"] },
  "shared/http": { name: "@unset/shared-http", version: "0.0.0", dependencies: { a: "1.0.0" } },
  "domains/content": { name: "@unset/domains-content", version: "0.0.0", dependencies: { c: "^1.0.0" } },
  "node_modules/@unset/shared-http": { resolved: "shared/http", link: true },
  "node_modules/@unset/domains-content": { resolved: "domains/content", link: true },
  "node_modules/a": pkg("1.0.0"),
  "node_modules/c": pkg("1.0.0"),
  "node_modules/d": pkg("1.0.0"),
};
const withChanges = (changes: Packages, remove: string[] = []): Packages => {
  const next: Packages = { ...BASE, ...changes };
  for (const key of remove) delete next[key];
  return next;
};
const strays = (head: Packages, base: Packages = BASE) => lockfileStrays(lock(base), lock(head), ["shared/http"]);
const ADD_HONO = {
  "shared/http": { name: "@unset/shared-http", version: "0.0.0", dependencies: { a: "1.0.0", hono: "4.0.0" } },
  "node_modules/hono": pkg("4.0.0", { b: "^2.0.0" }),
  "node_modules/b": pkg("2.0.0"),
};

describe("lockfile scope", () => {
  test("lockfile_scope_dependency_added_passes", () => {
    expect(strays(withChanges(ADD_HONO))).toEqual([]);
    // An upgrade: the old copy was in the trusted package's closure on the base side.
    expect(strays(withChanges({ "node_modules/a": pkg("1.1.0") }))).toEqual([]);
  });

  test("lockfile_scope_hoisting_move_passes", () => {
    // Adding hono@4 that needs d@2 pushes nothing, but npm may move the root d@1 under its only user: a pure move of
    // the same name, version and content is not a change.
    const head = withChanges(
      {
        ...ADD_HONO,
        "node_modules/hono": pkg("4.0.0", { d: "^2.0.0" }),
        "node_modules/d": pkg("2.0.0"),
        "node_modules/c/node_modules/d": pkg("1.0.0"),
      },
      ["node_modules/b"],
    );
    expect(strays(head)).toEqual([]);
  });

  test("lockfile_scope_feature_bump_fails", () => {
    expect(strays(withChanges({ ...ADD_HONO, "node_modules/c": pkg("1.1.0") }))).toEqual([
      "node_modules/c (c@1.0.0)",
      "node_modules/c (c@1.1.0)",
    ]);
    // A feature workspace's own entry is outside too.
    const content = { name: "@unset/domains-content", version: "0.0.0", dependencies: { c: "^1.1.0" } };
    expect(strays(withChanges({ ...ADD_HONO, "domains/content": content }))).toEqual([
      "domains/content (@unset/domains-content@0.0.0)",
    ]);
  });

  test("lockfile_scope_removed_outside_fails", () => {
    expect(strays(withChanges(ADD_HONO, ["node_modules/d"]))).toEqual(["node_modules/d (d@1.0.0)"]);
    // The root entry is nobody's dependency.
    expect(strays(withChanges({ ...ADD_HONO, "": { name: "unset.sh", workspaces: ["shared/*"] } }))).toEqual([
      "(root) (unset.sh@?)",
    ]);
  });

  test("lockfile_scope_judges_paths_not_names", () => {
    // Adversarial review of P0.09f: an entry outside the trusted package's install tree fails even when a package of
    // the same name and version is in its closure, and a copy of a base package keeps its tarball and dependencies.
    const EVIL = { resolved: "https://evil.example/x.tgz", integrity: "sha512-EVIL", hasInstallScript: true };
    const nested = withChanges({ "domains/content/node_modules/a": pkg("1.0.0") });
    const swap = { ...ADD_HONO, "domains/content/node_modules/a": { ...pkg("1.0.0"), ...EVIL } };
    expect(strays({ ...nested, ...swap }, nested)).toEqual(["domains/content/node_modules/a (a@1.0.0)"]);
    const spoof = { name: "hono", version: "4.0.0", ...EVIL };
    expect(strays(withChanges({ ...ADD_HONO, "domains/content/node_modules/evil": spoof }))).toEqual([
      "domains/content/node_modules/evil (evil@4.0.0)",
    ]);
    const borrowed = { version: "4.0.0", ...EVIL };
    expect(strays(withChanges({ ...ADD_HONO, "domains/content/node_modules/hono": borrowed }))).toEqual([
      "domains/content/node_modules/hono (hono@4.0.0)",
    ]);
    // An alias name inside the closure is refused too: the key decides what Node loads.
    expect(strays(withChanges({ ...ADD_HONO, "node_modules/b": { ...pkg("2.0.0"), name: "c" } }))).toEqual([
      "node_modules/b (b@2.0.0)",
    ]);
    // A version the base already has may not change its tarball or grow dependencies at any path.
    expect(strays(withChanges({ ...ADD_HONO, "node_modules/a": { ...pkg("1.0.0"), ...EVIL } }))).toEqual([
      "node_modules/a (a@1.0.0)",
    ]);
    const grown = withChanges({
      ...ADD_HONO,
      "node_modules/a": pkg("1.0.0", { evil: "1" }),
      "node_modules/evil": pkg("1.0.0"),
    });
    expect(strays(grown)).toEqual(["node_modules/a (a@1.0.0)"]);
  });

  test("lockfile_scope_dev_flag_flip_passes", () => {
    // A dependency that only tooling used becomes a runtime one: npm drops `dev: true` on its entry.
    const base = withChanges({ "node_modules/v": { ...pkg("2.0.0"), dev: true } });
    const runtime = { name: "@unset/shared-http", version: "0.0.0", dependencies: { a: "1.0.0", v: "2.0.0" } };
    const head = withChanges({ "shared/http": runtime, "node_modules/v": pkg("2.0.0") });
    expect(strays(head, base)).toEqual([]);
    expect(strays(base, head)).toEqual([]);
  });

  test("lockfile_scope_unreadable_fails", () => {
    expect(lockfileStrays({}, lock(BASE), ["shared/http"])).toEqual(["package-lock.json has no packages map"]);
    expect(lockfileStrays(lock(BASE), null, ["shared/http"])).toEqual(["package-lock.json has no packages map"]);
  });

  test("lockfile_rides_with_trusted_dependency_change", () => {
    // Ruling 2026-10-05 02:50Z: the generated root lockfile rides along only when a trusted package's package.json
    // changes a dependency field and everything else is trusted base or its riders.
    const LOCK = "package-lock.json";
    const MANIFEST = "shared/http/package.json";
    const HONO = { "node_modules/hono": { version: "4.0.0" } };
    // A lockfile diff that adds `hono` for shared/http only; the scope check itself is in lockfile-scope.test.ts.
    const packages = (deps: Record<string, string>, extra: object = {}) => ({
      packages: {
        "shared/http": { name: "@unset/shared-http", version: "0.0.0", dependencies: deps },
        "node_modules/a": { version: "1.0.0" },
        ...extra,
      },
    });
    const inScope = { base: packages({ a: "1.0.0" }), head: packages({ a: "1.0.0", hono: "4.0.0" }, HONO) };
    const run = (paths: string[], dependencyChanges: string[], lockfiles: DocFacts["lockfiles"] = inScope) =>
      checkTrustedBaseIsolation(paths, ["/shared/http/"], {
        parsedPaths: [],
        findings: [],
        docs: {
          regular: new Set(paths),
          licenceOnly: new Set(),
          dependencyChanges: new Set(dependencyChanges),
          lockfiles,
        },
      });
    expect(run([LOCK, MANIFEST, "shared/http/server.ts", "shared/http/server.test.ts"], [MANIFEST])).toEqual({
      ok: true,
      touched: true,
    });
    // No dependency change in a trusted manifest (none changed, or only `scripts`): the lockfile is feature.
    expect(run([LOCK, "shared/http/server.ts"], [])).toEqual({ ok: false, outside: [LOCK] });
    expect(run([LOCK, MANIFEST, "shared/http/server.ts"], [])).toEqual({ ok: false, outside: [LOCK] });
    // A dependency change in a feature package does not carry the lockfile into a trusted-base PR.
    const feature = "domains/content/package.json";
    expect(run([LOCK, feature, "shared/http/server.ts"], [feature])).toEqual({
      ok: false,
      outside: [LOCK, feature],
    });
    // Anything else beside it still fails, the root manifest included.
    expect(run([LOCK, MANIFEST, "shared/http/server.ts", "domains/content/x.ts"], [MANIFEST])).toEqual({
      ok: false,
      outside: ["domains/content/x.ts"],
    });
    expect(run([LOCK, MANIFEST, "package.json"], [MANIFEST, "package.json"])).toEqual({
      ok: false,
      outside: ["package.json"],
    });
    // Per-entry scope (ruling 02:50Z, refined): an entry outside the trusted package's closure, or an unreadable
    // lockfile, keeps it outside with the entries named.
    const stray = { base: inScope.base, head: { packages: { ...inScope.head.packages, "node_modules/c": {} } } };
    expect(run([LOCK, MANIFEST], [MANIFEST], stray)).toEqual({
      ok: false,
      outside: [`${LOCK} (node_modules/c (c@?))`],
    });
    expect(run([LOCK, MANIFEST], [MANIFEST], null)).toEqual({ ok: false, outside: [`${LOCK} (unreadable)`] });
    // Only the root lockfile; a nested one is just a path.
    expect(run(["shared/http/package-lock.json", MANIFEST], [MANIFEST])).toEqual({ ok: true, touched: true });
    expect(run(["domains/content/package-lock.json", MANIFEST], [MANIFEST])).toEqual({
      ok: false,
      outside: ["domains/content/package-lock.json"],
    });
  });
});
