# 0022 — web gets its own egress network; we use the shared PLC

Status: Proposed (awaiting Alex in the P2.05e pull request)

## Context
Sign-in has to read identities from the network. The OAuth client in `web` resolves a DID document from the PLC
directory, checks a handle through DNS TXT or `https://<handle>/.well-known/atproto-did`, and fetches other servers'
OAuth metadata. Today `web` joins only internal networks (`db`, `app`), a rule set by the architecture thread's 02:05Z
option C ruling and pinned by `web_only_on_internal_networks`, so none of that can leave the stack.

The plan had the local stack run its own PLC (P1.34t to P1.34z) so that seeded test identities never reach the public
directory. On 2026-10-16 Alex decided against hosting any PLC: we use the shared public directory at `plc.directory`,
and `web` gets its own egress network with net-guard as its only way out. That is a network boundary, expensive to
reverse, so it needs a record (D8).

## Decision
1. **One PLC, the shared one.** `web` reads DID documents from `https://plc.directory` in every environment
   (`PLC_URL`). We run no PLC directory of our own; P1.34v, P1.34y and P1.34z are dropped. Where the local PDS
   publishes the accounts it creates is decided separately.
2. **`web_egress`.** A non-internal network that only `web` joins, in `compose.dev.yaml` and `compose.local.yaml`, with
   its row in `deployment/networks.dev.json`. `web` keeps `db` and `app`; the PDS is never on `web_egress`.
3. **net-guard is the only way out.** Every outbound request `web` makes goes through `infrastructure/net-guard`:
   resolve, vet, pin the address, no redirects, size and time caps. The `plc` policy allows `plc.directory` alone;
   the `atproto` policy allows public addresses on 443; our own PDS is the one `NETGUARD_INTERNAL_HOSTS` entry. The
   lint rule against bare `fetch` and the egress CI guard stay as they are.

## Alternatives
- **A local PLC on the local stack** (P1.34v, the official did-method-plc image): rejected by Alex; it is a service,
  a database and a role to run and patch for test identities only.
- **An allowlisting egress proxy** (the P3.02 pattern for Tap: an internal network shared with a proxy that allows
  named hosts): more parts, and it cannot allow handle resolution, which may name any host. It stays available if a
  measured need appears, for example at P5.02's prod network table, which already names an `egress-web` network.
- **No egress for web:** sign-in could not confirm who signed in, because the callback checks the token's `sub`
  against the DID document.

## Consequences
`web` can reach any public host on 443, so net-guard is the control that keeps it from internal addresses and
non-HTTPS targets; a code path that bypassed net-guard would reach the internet, which the bare-`fetch` lint rule and
the egress guard exist to stop. Typed handles can now resolve, so handle sign-in works where the handle's host is
public. Requests to `plc.directory` depend on its availability; a failure reads as `identity_unavailable`, never as
"not found". The architecture thread's "web has no way out" ruling is replaced for `web` only; `postgres` and
`migrate` stay on internal networks.

## Compliance
`web_leaves_only_through_its_own_egress` (`deployment/compose.dev.test.ts`) fails if `web` joins any other
non-internal network or another service joins `web_egress`; `compose_dev_networks_match_table` and preflight C17 hold
the compose files to the network table; `compose.local.test.ts` keeps the local file's networks equal to dev's.
net-guard's own tests cover the policies. Reviewed at P5.02, when the prod network table is built.
