---
title: Glossary
weight: 3
---

Definitions are [`docs/human/glossary.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/glossary.md). One sentence per word lives there. This page does not copy them. It names words that have code on this tree, and groups that do not.

## On this tree

| Word | Code |
| --- | --- |
| DID, handle | `parseDid` and `parseHandle` in `domains/identity/syntax.ts` |
| DID document | `ResolvedDid` in `domains/identity/did-doc.ts` |
| verifyHandle | `createHandleVerifier` in `domains/identity/verify-handle.ts` returns `verifyHandle`. `check` keeps a handle when the document claims it and `resolveHandle` returns the same DID. |
| PDS | `infrastructure/pds` |
| PLC | Policy `plc`, host `plc.directory`, in `infrastructure/net-guard/src/policies.ts`. `localPlc` is `http://plc:2582`. |
| lexicon | `shared/lexicons` |
| record | `sh.unset.profile`, `sh.unset.section`, `sh.unset.follow` and `sh.unset.authApp` in `shared/lexicons/schemas/` |
| permission set | `sh.unset.authApp` is `type: permission-set`. `scopeString` in `shared/lexicons/src/scope.ts` requests `include:` plus that id. |
| net-guard | `infrastructure/net-guard`. Exports include `guardedFetch` and `createNetGuard`. |
| seal | `seal` and `unseal` in `infrastructure/seal/seal.ts`. `sealStream` and `unsealStream` in `infrastructure/seal/sealStream.ts`. |
| session | `infrastructure/session`. Table `app.session` in `infrastructure/postgres/migrations/0011_app_session.sql`. |
| audit | `appendAudit` in `infrastructure/audit` |

The glossary's word `step` names one entry of `docs/ai/book/`.

## Not on this tree

| Word or group | Mark |
| --- | --- |
| sealTo | `infrastructure/postgres/sealedColumns.ts` allows the form `sealTo`. `infrastructure/seal` has no `sealTo` export. The glossary names P1.14a. (planned) |
| draft, publish, unpublish | No draft store. [PLAN.md](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md) §8 Phase 2. (planned, Phase 2) |
| eraseDid | No `eraseDid` function and no SQL `erase_did`. `infrastructure/postgres/didColumns.ts` names it as P3.07. PLAN §8 Phase 3. (planned, Phase 3) |
| Tap, firehose, relay | No `infrastructure/tap`. PLAN §8 Phase 3. (planned, Phase 3) |
| media proxy | `interfaces/media/routes.manifest.json` is `GET /health` only. PLAN §8 Phase 3. (planned, Phase 3) |
| Ozone, labeler | PLAN §8 Phase 5. `shared/lexicons/src/scope.ts` says the Ozone DID does not exist yet. (planned, Phase 5) |
| Arachnid Shield, fingerprint | No `infrastructure/arachnid`. PLAN §8 puts the real client in Phase 5. (planned, Phase 5) |
| Matrix section (homeserver, MAS, MXID, Megolm, and the rest of that section) | No `apps/chat`. No `infrastructure/matrix`. PLAN §8 Phase 6. (planned, Phase 6) |
| pds-admin | Named in `ENTRYPOINTS` in `scripts/docs/docs.ts`. No `interfaces/pds-admin`. PLAN §8 Phase 2 names a minimal one. (planned, Phase 2) |
| chat-admin | Named in the same `ENTRYPOINTS`. No `interfaces/chat-admin`. PLAN §8 Phase 6. (planned, Phase 6) |
| Spaces | [ADR 0005](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0005-atproto-spaces-destination.md). No Spaces code on the tree. PLAN §3 says it waits for an official PDS release and the spec. (planned) |
