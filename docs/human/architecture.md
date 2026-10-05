# Architecture

How unset.sh is put together, what it optimises for, and which architecture rules a machine checks.
Repo path: `docs/human/architecture.md` (engineering rule AB-4). The folder layout and its rules are in
[`engineering/architecture-and-development-guideline.md`](engineering/architecture-and-development-guideline.md);
the full rule set is [`engineering/engineering-rules.md`](engineering/engineering-rules.md).

## What we optimise for, in order

Adopted by Alex on 2026-10-04 with the engineering rules (decision 35). When two of these pull in
different directions, the higher one wins.

1. **Security and privacy.** Fail closed, collect the least data, isolate what holds secrets.
2. **Evolvability by AI authors.** Small, predictable modules and checks that catch a wrong edit
   before a person has to.
3. **Operational simplicity on one host.** One Postgres, Compose, no extra services without a
   measured reason.

We deliberately do not optimise for: horizontal scale, multi-region availability, or zero-downtime
for every change. Each would add moving parts before the closed test shows a need (rule AB-3).

## The shape in one paragraph

People use three apps (`apps/web`, `apps/admin`, `apps/chat`). Each request enters through one
process in `interfaces/`, which checks who is asking, calls a product rule in `domains/`, and reaches
outside systems (Postgres, the PDS, Tap, Matrix, storage, Arachnid, email) only through
`infrastructure/`. Every running process has its own folder, container, database role and network,
so a fault or a compromise in one does not reach the others. `pds-admin` and `chat-admin`, which
hold the admin credentials, import nothing but their own folder, Node built-ins and
`shared/admin-envelope/`.

## Architecture rules and how each is checked

*Checked* means CI fails when the rule is broken. *Planned* names the step that builds the check; until it merges,
review covers the rule. *Review-only* means a person or the PR template checks it, with the reason no tool can.

| Rule | What it says | Checked by |
|---|---|---|
| ADG §1, AB-1 | Folder dependencies form an allowlist matrix; any unlisted edge fails | checked: `MATRIX`, `depcruise_unlisted_edge_fails`, `depcruise_matrix_rows_have_fixtures` |
| ADG §1 | Apps never import each other | checked: `no-app-to-app` |
| ADG §1 | Apps import only `shared/` | checked: `app-only-shared` |
| ADG §1 | Only the serving interface imports its app's render entry | checked: `app-render-entry-only` |
| ADG §1 | Interfaces never import each other | checked: `no-interface-to-interface` |
| ADG §1 | `web` never imports `admin` | checked: `web-not-admin` |
| ADG §2, AB-1 | Domains do not depend on infrastructure, interfaces or apps | checked: `domain-pure` |
| ADG §1, DC-2 | A domain reaches another domain only through its `index.ts` | checked: `domain-cross-via-index` |
| DC-2 | Modules under `infrastructure/` and `shared/` are reached only through their `index.ts` | checked: `infra-shared-via-index` |
| ADG §1 | Domains use no Node I/O built-ins | checked: `domain-no-io-builtins` |
| ADG §1 | No two tracked paths differ only in letter case | checked: `scripts/guards/case-collision.ts`, `case_pair_file_fails`, `case_pair_dir_fails` |
| ADG §1 | Product code never imports repository tooling (`scripts/`, `tests/`, configs) | checked: `no-product-imports-tooling` |
| ADG §2 | Infrastructure implements domain contracts and never reaches an entry point | checked: `infrastructure-not-entry` |
| AB-2 | Adapters are built only in the process's composition root (`main.ts`/`compose.ts`) | checked: `scripts/guards/composition-root.ts`, `composition_root_split` (each interface's main.ts has a compose.ts beside it, imports it, and imports nothing from infrastructure); `domain-pure` keeps adapters out of domains. Review-only: `MATRIX` lets an interface import infrastructure, and no tool tells construction from use |
| AB-2 | A port exists only for I/O or non-determinism | review-only: no tool can tell why an interface exists |
| ADG §1 | `shared/` leaf folders import nothing product-specific | checked: `shared-leaf` |
| ADG §1 | `pds-admin` and `chat-admin` import only themselves, Node built-ins and the zero-dependency allowlist | checked: `admin-services-zero-deps`, `depcruise_allowlist_exact` |
| ADG §1 | A folder on the zero-dependency allowlist obeys the same rule | checked: `allowlist-zero-deps` |
| ADG §1 | A vendor SDK is imported in one adapter folder per runtime | checked: `vendor-sdk-one-adapter` |
| plan §5.4 | net-guard imports only Node built-ins, undici and its own files; its *.test.ts may also import fast-check and vitest | checked: `net-guard-leaf` |
| TE-1 | Fakes are used only in tests and in non-production composition roots | checked: `fake-only-in-composition-root`, `fake_boot_refused_in_prod` |
| DC-1 | No dependency cycles | checked: `no-circular` |
| DC-1 | No orphan modules | checked: `no-orphans` |
| DC-1 | Modules are deep; functions do one job | review-only: no tool measures depth |
| AB-3 | A new process, role or orchestrator needs an ADR naming its driver | review-only: the driver is a judgement; backed by the grant-matrix test for roles and ADR 0011 for orchestrators |
| AB-4 | Every guard proves it examined more than zero items and fails on a known-bad fixture | checked: `scripts/guards/guards.test.ts`, `depcruise_cruised_nonzero` |
| DM-2 | Transactions are opened only in `infrastructure/postgres/tx.ts` | planned: P1.11 |
| DA-1 | `idx` can be dropped and rebuilt without losing a decision | planned: P3.03 |
| SE-6 | A PR that touches the trusted base touches nothing else, and a PR that changes a check changes no product path | checked: `trusted_base_isolated`, `trusted_base_list_from_codeowners`, `check_plus_product_fails`, `lockfile_rides_with_trusted_dependency_change` |

The docs test (P0.09, `architecture_rule_table_matches_depcruise`) reads this table. It fails if a named check
does not exist, a `forbidden` rule or `MATRIX` has no row, a planned step has already merged, or a review-only row
has no reason.

## Views

Each view is generated or checked from source when its first process exists (rule AB-4, P2).

- **Module view:** the folder dependency graph, generated by dependency-cruiser; CI fails on a diff.
- **Runtime view:** the processes, their database roles and the networks each may reach, checked
  against the Compose file and the grant matrix.
- **Deployment view:** hosts, edge and what is public (only 443 and 80), checked against the
  deployment preflight.

## Where to read next

- Feature ownership paths: `docs/human/features/`.
- Why a decision was made: `docs/human/decisions/`.
- Words we use: `docs/human/glossary.md`.
