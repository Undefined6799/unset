---
title: Checks
weight: 2
---

`npm run check` is the local gate. The script in the root [`package.json`](https://github.com/Undefined6799/unset/blob/main/package.json) is:

```sh
npm run typecheck && npm run lint && npm run guards && npm test
```

| Part | Command | What it covers |
| --- | --- | --- |
| `typecheck` | `tsc -b` | The composite TypeScript build |
| `lint` | `biome ci .` | Format and lint. Biome `2.5.15` |
| `lint` | `depcruise --config scripts/lint/.dependency-cruiser.cjs .` | Import boundaries. dependency-cruiser `18.5.0` |
| `guards` | `vitest run scripts/guards` | The guards under `scripts/guards/`, including [notes](../docs-rules/) |
| `test` | `node scripts/test/run.ts` | The test runner below. Vitest `5.0.4`, TypeScript `7.0.2` |

Versions are the root `devDependencies`.

## The test runner

[`scripts/test/run.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/test/run.ts) discovers every `*.test.ts` file. The run fails unless each file the mode starts was selected by the include, ran at least one passing or failing test, and skipped nothing. A stray `*.spec.*` file outside `tests/e2e/`, or a `*.test.js` file, fails the same command.

| Mode | How it starts | What runs |
| --- | --- | --- |
| local | `npm test`, when `CI` is not `true` and `GITHUB_ACTIONS` is unset | Every project except `images` |
| units | `npm test -- --units` | Every project except `images`, under CI's rules: every listed non-image test file must run, and nothing is skipped |
| ci | `CI=true` or `GITHUB_ACTIONS=true`, neither flag | Non-image projects, then `images` |
| images | `npm run test:images` | The `images` project only |

`--units` and `--images` are exclusive. `GITHUB_ACTIONS` set while `CI` is not `true` is refused. A local run prints that the images project was left for CI. `npm run test:images` exits when `docker info` fails.

## CI

[`.github/workflows/ci.yml`](https://github.com/Undefined6799/unset/blob/main/.github/workflows/ci.yml) runs `code` and `image-tests` in parallel. `check` is the required name in [`.github/required-checks.json`](https://github.com/Undefined6799/unset/blob/main/.github/required-checks.json). It needs both and fails unless both succeeded.

| Job | What it runs |
| --- | --- |
| `code` | Includes typecheck, lint, guards, then `npm test -- --units` |
| `image-tests` | `npm run test:images` |
| `check` | No tests. Fails unless `code` and `image-tests` both succeeded |

Postgres tests run with the non-image projects. They start the pinned image themselves. [Setup](../setup/) names that path. Image tests (`*.image.test.ts`) are the `images` project. Local and units leave them out.

## Endpoint pages

`endpoint_pages_match_manifests` in [`scripts/docs/endpoints.test.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/docs/endpoints.test.ts) fails when `docs/site/content/endpoints/` is stale. `npm test` runs the file, and `npm run check` runs `npm test`. CI job `code` runs it with `npm test -- --units`. The rewrite command and the yaml inputs are on [Docs rules](../docs-rules/).
