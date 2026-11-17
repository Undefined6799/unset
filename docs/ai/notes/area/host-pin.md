---
id: host-pin
type: area
status: current
areas: ["[[host-pin]]"]
summary: "Hub for shared/host-pin: pins a path, and the Docker daemon's socket, to this machine."
code: [shared/host-pin/index.ts, shared/host-pin/walk.ts, shared/host-pin/docker-host.ts]
sources: [docs/ai/book/phase-1.md]
importance: normal
related: ["[[deployment]]", "[[tests]]"]
replaced_by: null
tags: [area, host-pin]
checked: 2026-11-17
---
# host-pin

**What it owns.** Checks that a path, and the Docker daemon's socket, are on this machine and that only root or the
deploy user can change them (P1.33h). Generic and MIT-licensed: it knows nothing of Compose or the preflight.

**Files.**
- `walk.ts`: C9's path walk (P1.30, P1.34p), moved here unchanged from `deployment/preflight/checks/secrets.ts`:
  `walkTo`, `resolveChecked`, `within`, `foreignFilesystem`. Each refusal is a fixed reason from `WALK_REASONS`
  (missing, under /proc, changeable by another user, too many links, wrong kind), never the value.
- `docker-host.ts`: `localDockerHost` (P1.34s), moved unchanged from `deployment/preflight/stack.ts`. It accepts only a
  `unix://` socket on this machine whose folder passes the walk and which is a real socket owned by root or the
  deploy user; tcp://, ssh:// and anything else are refused.

**Who uses it.** The deploy preflight ([[deployment]], `deployment/preflight/`) and the local token reader, and test
support in [[tests]].

**Links.** [[deployment]], [[tests]]; `docs/ai/book/phase-1.md` P1.33h and P1.34s.
