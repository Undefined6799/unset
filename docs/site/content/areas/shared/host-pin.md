---
title: host-pin
weight: 3
---

Pins a path, and the Docker daemon's socket, to this machine. Package `@unset/shared-host-pin`. It knows nothing of Compose. The move from the preflight is architecture record `2026-10-13-p129h-local-token-reader`.

## Owns

`shared/host-pin/docker-host.ts`: `localDockerHost` reads `DOCKER_HOST`, or `DEFAULT_DOCKER_HOST` (`unix:///var/run/docker.sock`). It accepts a `unix://` URL with an absolute path. The socket's folder must pass `resolveChecked`. The socket itself must be a socket, not a link, owned by root or the deploy user, with `nlink` 1. `tcp://`, `ssh://`, `npipe://` and any other shape throw `UsageError`. Reasons are fixed text.

`shared/host-pin/walk.ts`: `resolveChecked` walks from `/` and returns a `WalkProblem` or `null`. The reason words are `WALK_REASONS`: `missing`, `procfs`, `changeable`, `loop`, `kind`, `fuse`. `hostWalk` is the `WalkInputs` that call `node:fs`. `within`, `foreignFilesystem` and `FILESYSTEM_NAMES` are exported from the same file.

## May import

Row `shared-host-pin`: its own files and Node built-ins. No npm package and no other `shared/` module. A `*.test.ts` is the tooling row, so its test runner import is not this row.

Who may import `shared/host-pin/index.ts`:

| From | Rule |
| --- | --- |
| `deployment/preflight/` | `deployment-preflight` names this index and nothing else under `shared/` |
| Tooling | The tooling row |

On this tree: `deployment/preflight/stack.ts`, `deployment/preflight/checks/build.ts`, `deployment/preflight/checks/secrets.ts`, `deployment/preflight/checks/types.ts`, and `tests/support/pds-email-token.ts`.

`package.json` has no `dependencies`.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/host-pin/index.ts` |
| `localDockerHost`, `DEFAULT_DOCKER_HOST`, `hostWalk`, `UsageError` | `shared/host-pin/docker-host.ts` |
| `resolveChecked`, `within`, `foreignFilesystem`, `FILESYSTEM_NAMES`, `WALK_REASONS` | `shared/host-pin/walk.ts` |

## Data

No schema, role or table. The inputs are a path and the caller's environment.
