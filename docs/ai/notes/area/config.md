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
checked: 2026-10-16
---
# config

**What it owns.** Typed configuration for every entrypoint.

**Files.**
- `load.ts`: reads the environment once at boot and refuses to start on any missing or invalid key. Problems name
  keys and reasons, never values. `exitOnConfigError` gives a check that runs after loading (the web server's
  connection budget, P2.04c) the same exit 78 and `config.invalid` lines; other errors pass through.
- `schema.ts`: field kinds. A field parses one string and may carry a rule across keys, so merging the field merges
  its rule.
- `secret.ts`: `Secret` prints as `[secret]` everywhere; the value leaves only through `reveal()`.
- `netGuard.ts`: the net-guard fields every egress-making entrypoint merges in, and `HOSTNAME`, the exact-hostname
  pattern a `str` field reuses (the web server's `PDS_HOSTNAME` and `HANDLE_SUFFIX`, P2.05).
- `permanent.ts`: values that can never change after first use (the Matrix `server_name`, the permission set NSID),
  Alex's answers recorded in ADR 0020 and pinned by `permanent.test.ts` (P1.32). They are constants, not config keys.

**How data flows.** Each `interfaces/*/config.ts` merges the fields it needs → `bootOrExit` at startup → typed
values to the composition root. Never print resolved config or the environment.

**Links.** [[net-guard]].
