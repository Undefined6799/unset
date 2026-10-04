# Adding a workspace

A workspace is created by the step that lands its first code, never ahead of it (guideline §1). This page is the
convention; `references.test.ts` checks every rule on it, and `references.ts` holds the checks.

## Where

`<top>/<name>/`, where `<top>` is one of `apps`, `interfaces`, `domains`, `infrastructure` or `shared` (decision 34).
TypeScript sits directly in that folder, with no `src/` level; SQL sits under `infrastructure/postgres/migrations/`.
There is no `packages/`, `modules/` or `plugins/` folder (decisions 25 and 34). Integration tests go to
`tests/integration/<area>/` and end-to-end tests to `tests/e2e/`; neither is a workspace.

## Files

- `package.json`: `name` `@unset/<top>-<name>` (for example `@unset/domains-identity`), `private: true`,
  `type: "module"`, `version: "0.0.0"`, `license` `MIT` under `shared/` and `AGPL-3.0-only` elsewhere. Add
  dependencies only in the step that needs them, pinned exactly. Another workspace it imports by package name goes in
  `dependencies` as `"@unset/<top>-<name>": "0.0.0"`.
- `tsconfig.json`: `extends: "../../tsconfig.base.json"`, `compilerOptions` `{ composite: true, rootDir: ".",
  outDir: "dist" }`, and `references` to each workspace it imports (`{ "path": "../../shared/errors" }`).
- At least one `*.test.ts` beside its code.
- `index.ts`: the only file other folders import from an `infrastructure/` or `shared/` workspace (rule DC-2,
  dependency-cruiser `infra-shared-via-index`); a domain is reached the same way (`domain-cross-via-index`).

Then add `{ "path": "<top>/<name>" }` to the root `tsconfig.json` `references` and run `npm install` so the
lockfile records the workspace.

## What it may reference

The dependency-cruiser `MATRIX` in `.dependency-cruiser.cjs` is the one list; a workspace may reference another when
the MATRIX lets its code import that workspace's `index.ts` (or, for an app, its render entry). In short:

- `apps/<x>`: `shared/*` only. Islands reach the server over HTTP, never by import.
- `interfaces/http` and `interfaces/admin`: their own app's render entry, `domains/*`, `infrastructure/*`,
  `shared/*`. Every other interface: `domains/*`, `infrastructure/*`, `shared/*`. No interface references another.
- `interfaces/pds-admin`, `interfaces/chat-admin`: only the zero-dependency allowlist (today `shared/admin-envelope`),
  listed in `dependencies` and `references` like any workspace. "Zero dependencies" means no third-party package
  (plan §5.2): their dependencies (and devDependencies apart from test tooling) hold only allowlisted `@unset/*`
  workspaces, and their installed closure (`npm ls --workspace … --all`) holds no third-party package. An
  allowlisted workspace has no references and no dependencies.
- `domains/<x>`: `shared/errors`, `shared/config` (types only), `shared/lexicons`, and another domain's `index.ts`
  where a feature needs it. No npm dependencies (rule AB-1).
- `infrastructure/<x>`: `domains/*`, `shared/*`, `infrastructure/net-guard`, `infrastructure/seal`.
  `infrastructure/net-guard` references nothing.
- `shared/<x>`: `shared/*`; `shared/ui`, `shared/lexicons` and `shared/admin-envelope` reference nothing.

A new edge is a MATRIX row (with its fixture in `scripts/lint/depcruise.test.ts`) in the same PR.

## Checks that catch a mistake

- `npm run typecheck` (`tsc -b`) builds every referenced project. It does not by itself notice an import of a
  workspace that is missing from `references`, because npm links every workspace into `node_modules`; the
  references test does.
- `npm run lint` runs the boundary rules on every import.
- `npm test` fails if a workspace's test file did not run, and the Vitest project for each top-level folder selects
  it without further configuration.
