# 0012 — Licences: AGPL-3.0-only for the product, MIT for shared/

Status: accepted (Alex, 2026-10-03 11:50Z, decision 27; plan §11 Q12; the MIT folder set by decision 34
amendment A6, 2026-10-04).

## Context
The repository stays private until launch, but every package needs its licence before any of it is
published, and the lexicon schemas are published under MIT by P1.35 in Phase 1. Plan §11 Q12 asked
which licence unset.sh's own code carries; launch gate L.05 re-checks the answer before launch.

## Decision
- Everything outside `shared/` is AGPL-3.0-only: the root `LICENSE` covers it, and every
  `package.json` outside `shared/` says `"license": "AGPL-3.0-only"`. That includes
  `infrastructure/net-guard`.
- Every package under `shared/` is MIT (today `config`, `errors`, `http`, `log`; later `lexicons`,
  `ui`, `i18n`, `admin-envelope` and any other generic helper): its `package.json` says
  `"license": "MIT"`, and it carries its own `LICENSE`, a copy of the root `LICENSE-MIT`
  (`Copyright (c) 2026 Alex (Undefined6799)`).
- A new folder outside `shared/` is AGPL unless this record is superseded.
- Dependencies, checked by `scripts/licence/check.ts` over the root's and each package's production tree
  (`npm ls --all --json --long --omit=dev`):
  - an MIT package may depend only on permissive licences: MIT, MIT-0, ISC, 0BSD, BSD-2-Clause,
    BSD-3-Clause, Apache-2.0, BlueOak-1.0.0, CC0-1.0, Unlicense, Zlib. It never depends on an AGPL
    workspace package;
  - an AGPL-3.0-only package may depend on those and on AGPL-3.0 code;
  - an SPDX expression passes when one `OR` branch passes and every `AND` part does; `WITH` passes
    only for an exception that widens the licence (today `LLVM-exception`), since some (Commons
    Clause) restrict it;
  - anything else, including a missing licence field, is a conflict. The agent stops and asks Alex
    with the dependency named, and an accepted exception is recorded here by a superseding record.

## Alternatives
- AGPL-3.0-only for everything (the plan's first recommendation): protects against a closed hosted
  fork, but other atproto apps could not reuse the record types and small helpers freely.
- MIT or Apache-2.0 for everything: maximum reuse, but anyone may run a closed hosted fork.
- AGPL for the product, MIT for the building blocks (chosen): reuse of `shared/`, protection for
  the product, at the cost of one more licence line per package.

## Consequences
`shared/` code may not import product code (already true: decision 34 and dependency-cruiser), so
MIT packages stay free of AGPL code. The repository stays private until launch; no step changes
its visibility, publishes a package or pushes to a public remote, except P1.35 publishing the
lexicon schemas. A CLA or DCO is decided when outside contributions open. How far AI-authored
code is protected by copyright is unsettled, which affects how enforceable any licence is.

## Compliance
`scripts/licence/check.test.ts`: `files_consistent` (every `shared/*` package MIT with its
`LICENSE`, every other package and the root AGPL-3.0-only), `mit_package_no_agpl_dependency`,
`licence_check_logic`, `spdx_expressions`, `deduped_subtree_still_checked`,
`optional_peer_not_installed_skipped` and `repository_has_no_conflicts` (the real tree). Launch
gate L.05 re-checks this record.
