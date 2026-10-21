---
title: Glossary
weight: 3
---

Definitions are [`docs/human/glossary.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/glossary.md). One sentence per word lives there. This page does not copy them. It names words that have code on this tree.

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

Roadmap: [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md).
