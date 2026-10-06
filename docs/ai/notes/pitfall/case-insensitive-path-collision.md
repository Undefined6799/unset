---
id: case-insensitive-path-collision
type: pitfall
status: current
areas: ["[[ci]]", "[[http]]"]
summary: "Two paths that differ only by case or Unicode form collide on macOS and Windows; a guard now refuses them."
code: [scripts/guards/case-collision.ts]
sources: [unset-plan/book-edits/2026-10-05-p105e-trusted-proxy-test-env.md, unset-plan/book-edits/2026-10-05-p009k-case-collision-guard.md]
importance: normal
related: []
replaced_by: null
tags: [pitfall, ci, http]
checked: 2026-10-06
---
# Paths that differ only by case collide on a laptop

**What goes wrong.** The step book planned `shared/http/proxy/clientIp.ts` beside `proxy/ClientIp.ts` (P1.05). Linux
CI is happy with both, but on a case-insensitive file system (the macOS and Windows defaults) they are one file, so a
checkout there silently keeps only one of them. The same happens to names that differ only by Unicode normalisation
(NFC against NFD), by final sigma, or to a file beside a folder of the same name.

**Why.** Git stores paths as bytes; the file system on the other end decides what counts as the same name.

**The rule.** No two tracked paths may fold to the same name (architecture guideline §1, ruling 2026-10-05).
`scripts/guards/case-collision.ts` folds every `git ls-files` path (NFC, case fold, final sigma) and fails on any
collision, with no escape. The P1.05 code landed as `shared/http/clientIp.ts` and `trustedProxy.ts` instead.

**Repair.** Easy before merge (rename one side); after a collision reaches main, every macOS clone needs a fresh
checkout once the rename lands.
