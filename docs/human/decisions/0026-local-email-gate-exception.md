# 0026 — Local-only email-gate exception for two test handles

Status: Proposed (awaiting Alex)

## Context
ADR 0023 says the local PDS publishes a few fixed test accounts, made once by hand. Alex named the first two
`alice.unset.im` and `bob.unset.im` (2026-10-17). Their emails stay unconfirmed. Agents must sign in as them and
use `/me`. P2.11's `requireVerified` still sends unconfirmed email to `/verify-email` (book, `docs/ai/book/phase-2.md`;
plan §5.3 "Email-verify gate"), so a local sign-in cannot reach `/me` without an exception.

On 2026-10-17 the book-edit PR (#970) listed three mechanisms and stopped. Alex chose mechanism 2: a local-only
exception in `requireVerified`. It is a new security mechanism, so the first PR that depends on it needs this
record (DO-1 / D8). This PR records it and does not implement `requireVerified`.

Real users still hit P2.11. Email confirmation stays for recovery and as a second factor. Plan §2 rule 4 and
§5.3 still say a query parameter never marks email confirmed, and only a PDS-verified email can be shown
publicly. The exception is the app gate only.

Alex also answered where those two accounts' credentials live: on the PDS, the same place as any other user's.

## Decision
1. **Mechanism 2.** `requireVerified` treats only `alice.unset.im` and `bob.unset.im` as verified, and only on
   the local stack. Every other account, and every other environment, still hits P2.11: unconfirmed email cannot
   use `/me`.
2. **Handle list, fail closed.** The exception is driven by a handle list that names those two and is set only
   on the local stack. Production must refuse to boot if that list is set. An unset list means no exception.
   No admin bypass, no forged membership, no "lock down later" path.
3. **Emails stay unconfirmed on the PDS.** The exception does not write `emailConfirmed` on the PDS, does not
   show an email as publicly verified, and does not rewrite P2.11 as optional. Confirmation stays for recovery
   and as a second factor.
4. **Credentials live only on the PDS.** Password, DID, and email for these two live only on the PDS, the same
   place as any other user's. The app does not keep a parallel password, DID, or mailbox store for them, and
   does not put them in the repository or a special sibling secrets file.
5. **Created once, signed in like a member.** The accounts are created once by hand on the local PDS (ADR 0023:
   nothing creates accounts per run). Agents sign in through the real PDS login, like a member.
6. **Not implemented here.** This record does not change `domains/identity/auth/gates.ts`, onboarding routes, or
   seed code. A later product PR implements `requireVerified`'s local branch and the production boot refusal.

## Alternatives
- **Session fixture** (mechanism 1 on #970): after OAuth, a Playwright test writes `sessions.setEmailConfirmed`.
  Rejected: it forges verified membership in the session table, does not by itself skip P2.05's callback
  redirect to `/verify-email`, and a stale P2.11 recheck would bounce when the PDS still says unconfirmed.
- **PDS `emailConfirmedAt` set once by hand** (mechanism 3 on #970): uses existing P2.11 with no product skip.
  Rejected: it contradicts "their emails are not confirmed", because the PDS would then report them confirmed.
- **No exception:** rejected; agents could not use `/me` as these two while mail is dropped on the local stack
  and the email-token reader refuses every stack (ADR 0023).

## Consequences
- `requireVerified` becomes a security mechanism with a named local exception. A wrong env that still carries
  the handle list is a production outage (boot refusal), not a silent skip.
- The two handles are public in this record and the book. Their passwords, DIDs, and mailbox addresses are not.
  This record does not name them.
- Identifying the local stack is the implementing PR's job. `UNSET_ENV` today is `dev`, `test` or `prod`
  (`shared/config/schema.ts`); `deployment/compose.local.yaml` still writes `dev`. This record does not add a
  `local` env value.
- A new required config key for the handle list would break every entrypoint's manifest test until the test
  envs carry it (`docs/ai/notes/pitfall/new-required-config-key-breaks-test-envs.md`). An absent list must mean
  no exception, so production can keep the key unset.
- Losing the local PDS volume loses the accounts' repositories (ADR 0023). New accounts mean new DIDs. The
  exception still names the handles, not the DIDs.
- P2.13a stays `[STOP]`. It uses these two, skips in-browser email confirmation for them only, and does not
  rewrite P2.11 as optional. The implementing PR must not leave those two on `/verify-email` after the local
  callback, or that skip cannot hold.
- Still open: whether more accounts than Alice and Bob come later; where the operator types the PDS password
  from (local env, a CI secret, or only in Alex's head). This record does not invent that location.

## Compliance
Reviewed when the first product PR implements `requireVerified`'s local exception and the production boot
refusal. That PR must show:
- only `alice.unset.im` and `bob.unset.im` pass unconfirmed, and only on the local stack;
- every other handle still 303s to `/verify-email`;
- production (and any non-local env) refuses to boot when the handle list is set;
- an unset list means no exception;
- no password, DID, or mailbox for these two appears in the repository or in a sibling secrets file.

`emailGate` in `domains/identity/auth/gates.ts` (P2.11, as on origin/main) still has no local exception. This
PR does not add one.
