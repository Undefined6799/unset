# 0023 — the local PDS publishes to the shared PLC

Status: Proposed (awaiting Alex in the P1.34t pull request)

## Context
ADR 0022 says we host no PLC directory, and leaves open where the local PDS publishes the accounts it creates. Today
`compose.local.yaml` points it at `http://plc:2582`, a service that will now never exist, so the local PDS cannot create
an account and a local sign-in has no one to sign in. The local PLC was planned (architecture record
2026-10-13-local-plc, Amendment 4) so that seeds and probes, which create accounts on every run (P1.29s, P1.29t), would
never write to the public directory. On 2026-10-16 Alex chose to publish local accounts to `plc.directory` and keep them
to a few fixed ones. It changes a security check (C28) and reverses a recorded design, so it needs a record (D8).

## Decision
1. **The local PDS publishes to `https://plc.directory`**, like dev and prod. C28 requires exactly that URL in every
   env; unset and look-alikes still fail.
2. **A few fixed test accounts, made once and reused.** They are created by hand, with an invite code and the PDS's own
   account creation. Nothing creates accounts per run. The email-token reader (P1.29h, P1.29i), which a seed
   would need to confirm a new account, keeps refusing every stack, because `PDS_DID_PLC_URL` names a host outside the
   local stack.
3. **Local names stay local.** Test handles stay under the dev root's constrained names, with no public DNS.

## Alternatives
- **A local PLC** (P1.34v): rejected in ADR 0022.
- **Signing in locally with real accounts on public PDSes:** their authorization servers must fetch our client metadata
  from its `client_id` URL, which a local stack does not serve publicly.

## Consequences
- Each test account is a permanent public PLC entry: a DID document naming its handle and a PDS endpoint on a
  local-only host. A PLC entry can be tombstoned but never deleted, and only with its rotation key, so the local PDS's
  rotation key (in `unset-dev-env/pds.env`) is kept for as long as we may want to tombstone them.
- The reference PLC server limits a service endpoint by length only (did-method-plc
  `packages/server/src/constraints.ts`, `assertValidIncomingOp`), so these entries are accepted. The first account
  confirms it against the live directory.
- Losing the local PDS volume loses the accounts' repositories. Their DIDs stay on the directory pointing at nothing,
  and new accounts mean new DIDs.
- No personal data is published: test handles and DIDs only. The accounts' email addresses stay in the local PDS.
- The PDS already reaches the directory through `pds_egress`. The local PLC pieces already merged (P1.34u's init file,
  P1.34y's `localPlc` policy, C17's `plc_pds` exemption) are now dead and are removed in their own cleanup.

## Compliance
C28 (`deployment/preflight/checks/pds.ts`) is held by `c28_dev_and_prod_use_exactly_the_public_plc` and
`local_c28_admits_only_the_public_plc`; `compose.local.test.ts` keeps the local PDS's PLC URL equal to dev's;
`pds_env_pinned` pins the local PDS's settings. Reviewed when the first fixed accounts are made.
