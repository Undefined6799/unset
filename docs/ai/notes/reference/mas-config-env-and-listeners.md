---
id: mas-config-env-and-listeners
type: reference
status: current
areas: ["[[matrix]]", "[[deployment]]"]
summary: "MAS 1.26 merges every MAS_* variable into its config, runs the server by default, and binds listeners by address."
code: [deployment/chat/dev/mas.yaml, deployment/preflight/checks/chat.ts]
sources: [https://github.com/element-hq/matrix-authentication-service/blob/v1.26.0/crates/cli/src/commands/mod.rs]
importance: high
related: []
replaced_by: null
tags: [reference, matrix, deployment]
checked: 2026-11-21
---
# MAS 1.26: config from the environment, default subcommand, listeners

**The rule.** At v1.26.0 `crates/cli/src/commands/mod.rs:90-109` builds the config from
`Env::prefixed("MAS_").split("_")` and then each file in `MAS_CONFIG`, split on `:`. So any `MAS_*` variable
(`MAS_PASSWORDS_ENABLED=true`) changes the config, and `MAS_CONFIG` may name several files. With no subcommand
`mas-cli` runs the server (`None => server`), so a container needs no `command`.

**Listeners.** A listener serves exactly the resources it lists; anything else answers 404. Tested 2026-11-21
with the 1.26.0 binary and `deployment/chat/dev/mas.yaml` (binds and paths swapped for loopback): the Synapse
listener answered discovery, `/oauth2/keys.json` and `/health`, and 404 for `/login`, `/register`, `/account/`,
`/graphql`, `/assets/`, `/_matrix/client/v3/login` and `/api/admin/v1/*`. The chat-admin listener served a
client-credentials token (`urn:mas:admin`) and `/api/admin/v1/users` (200 with it, 404 on the other listener). MAS
started cleanly with no `human`, `graphql`, `assets` or `compat` resource. A listener binds an address, not a
network: on a container with two networks, each listener must bind that network's own address.

**What we rely on.** Preflight C36 refuses any MAS variable but `MAS_CONFIG`, any `:` in it, and any env file
(ADR 0086). The admin API needs a token from the `oauth` resource, so chat-admin's listener carries both
(`docs/topics/admin-api.md`).

**Log line.** MAS logs `client.address` with every response at WARN; behind no edge it is an internal address.
