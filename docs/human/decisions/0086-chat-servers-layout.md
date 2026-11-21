# 0086 — The chat servers: upstream Synapse and MAS, reviewed config files, internal-only MAS listeners

Status: Proposed (awaiting Alex), 2026-11-21 (P6.02). Builds on ADR 0025 (the chat server name) and the chat build
plan's step 1 (2026-11-21), and alongside ADRs 0081 to 0085 (chat sessions, the service split, the server rule).

## Context

Chat needs Synapse 1.162.0 and MAS 1.26.0. Both are configured, not coded: every security property in the build
plan's step 1 tables is a setting. Three facts read in the pinned sources decide how they run:

- The Synapse image's `start.py` takes its config from `SYNAPSE_CONFIG_PATH`, and also reads `SYNAPSE_WORKER`, `UID`
  and `GID` (synapse `docker/start.py:234-314` at v1.162.0). MAS merges every `MAS_*` variable into its config and
  splits `MAS_CONFIG` on `:` into several files (`crates/cli/src/commands/mod.rs:90-109` at v1.26.0). A setting can
  therefore ride in beside the file through the environment.
- MAS with no subcommand runs the server (same file, `None => server`), so our Compose subset's ban on `command`
  needs no image of our own.
- A MAS listener binds addresses, not networks. A container on two networks answers every listener on both unless
  each listener binds only that network's address. chat-admin's calls need a client-credentials token, which only
  the `oauth` resource serves (`docs/topics/admin-api.md` at v1.26.0).

## Decision

1. **Images.** Synapse and MAS run their upstream images as shipped (`ghcr.io/element-hq/synapse:v1.162.0`, index
   digest `sha256:6b84a7bbac36f080b2d2e51e0289cf1b08b349598ea44a558df38d558f2c2311`;
   `ghcr.io/element-hq/matrix-authentication-service:1.26.0`, index digest
   `sha256:e089f1048a1d4a9a492ed17b9fe759100f1bd619407b001f5927928d88b780c4`, both read from the registry on
   2026-11-21), mirrored by digest as the PDS and Newt are (`deployment/mirror.list.json`, ADR 0033). The image with
   our server rule replaces the Synapse one in the server-rule step (ADR 0085).
2. **Config files.** Each server reads one reviewed file from the checkout, `deployment/chat/<env>/`, mounted
   read-only, with secrets only as paths under `/run/secrets`. Preflight C36 refuses a stack whose chat service sets
   any other variable, reads an env file, or mounts a file that differs from the reviewed values or holds a key the
   check does not list. The server name follows ADR 0025: `staging.unset.cc` under dev, `unset.cc` under prod; local
   has no chat server until it is ruled.
3. **Databases.** Each server has its own database and role in our existing Postgres, with its password in a file
   (libpq `passfile` for Synapse, `password_file` for MAS). No trust authentication.
4. **Networks.** No chat network reaches the outside. MAS has no route from the edge and two listeners, each bound to
   MAS's fixed address on one internal network: `discovery`, `oauth` and `health` at 10.250.38.3:8080 on the network
   it shares with Synapse, and `oauth` and `adminapi` at 10.250.38.11:8081 on the network it shares with chat-admin
   alone. `human`, `graphql`, `assets` and `compat` are mounted nowhere. Synapse has one client listener and no
   federation listener; the edge and the door reach only that.

## Alternatives

- **Our own MAS image with `CMD ["server"]`.** Not needed: MAS's default subcommand is the server.
- **MAS listeners on every address, separated by port only.** Synapse's network would reach the admin API's port.
  Rejected; the bind addresses are what keeps the admin API on chat-admin's network.
- **`adminapi` alone on chat-admin's listener (the build plan's table).** chat-admin could then not get its token
  without joining Synapse's network. Adding `oauth` there exposes nothing chat-admin's network did not need.
- **Settings through the environment.** Both servers accept them, but a variable is easy to add unreviewed beside a
  reviewed file. Refused by C36 instead.

## Consequences

- A change to a chat setting is a change to the file and to C36's list, reviewed together; C36's unit tests run the
  committed files through the same rules.
- The Synapse admin API is mounted on its client listener (Synapse mounts it with `client`); the edge must deny
  `/_synapse/*` when the chat site is added.
- Synapse's discovery document advertises MAS's internal name as issuer. Clients never talk to MAS (build plan step 2), so
  this is not a public address.
- MAS logs `client.address` on each response at WARN. With no edge route, that address is Synapse's or chat-admin's.

## Compliance

`deployment/preflight/checks/chat.ts` (C36) and `chat.test.ts`; the Compose wiring, mirror entries and an image test
that runs MAS with these listeners land with the servers' Compose services.
