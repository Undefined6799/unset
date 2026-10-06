---
id: new-required-config-key-breaks-test-envs
type: pitfall
status: current
areas: ["[[config]]", "[[http]]", "[[tests]]"]
summary: "A new required key in a shared config fragment turns every entrypoint's manifest test red; add it to test envs first."
code: [shared/config/load.ts]
sources: [unset-plan/book-edits/2026-10-05-p105e-trusted-proxy-test-env.md]
importance: high
related: ["[[config]]"]
replaced_by: null
tags: [pitfall, config, http, tests]
checked: 2026-10-06
---
# A new required config key breaks six tests at once

**What goes wrong.** Each `interfaces/*/routes.manifest.test.ts` loads its server's config from a fixed test
environment. When a shared fragment (for example the server kit's `httpKitConfig` in `shared/http`) gains a key with
no default, all six tests fail to boot the server. If the fragment is trusted base, those test files are product paths
and cannot ride in the same PR, so the PR cannot go green on its own (P1.05, `TRUSTED_PROXY_MODE`).

**Why it is safe to split.** `loadConfig` ignores environment keys it does not declare, except `UNSET_*` keys, which
it only warns about (`shared/config/load.ts`). Adding the key to the test envs first changes nothing on main.

**The rule.** Land a small product prelude PR first that adds the key to each fixed test env (the P1.05e pattern),
then the PR that makes it required. Use realistic test values, never values the new rule rejects (for a CIDR list,
never `0.0.0.0/0`).

**Repair.** Easy; it only costs an extra PR and a wait for the merge.
