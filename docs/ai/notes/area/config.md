---
id: config
type: area
status: current
areas: ["[[config]]"]
summary: "Hub for shared/config: typed config read once at boot, with secrets that never print."
code: [shared/config/index.ts]
sources: []
importance: normal
related: ["[[net-guard]]", "[[new-required-config-key-breaks-test-envs]]"]
replaced_by: null
tags: [area, config]
checked: 2026-10-06
---
# config

**What it owns.** Typed configuration for every entrypoint.

**Files.**
- `load.ts`: reads the environment once at boot and refuses to start on any missing or invalid key. Problems name
  keys and reasons, never values.
- `schema.ts`: field kinds. A field parses one string and may carry a rule across keys, so merging the field merges
  its rule.
- `secret.ts`: `Secret` prints as `[secret]` everywhere; the value leaves only through `reveal()`.
- `netGuard.ts`: the net-guard fields every egress-making entrypoint merges in.

**How data flows.** Each `interfaces/*/config.ts` merges the fields it needs → `bootOrExit` at startup → typed
values to the composition root. Never print resolved config or the environment.

**Links.** [[net-guard]].
