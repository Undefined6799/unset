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

People will use three apps. Today only `apps/web` exists. `apps/admin` is planned, phase 3.
`apps/chat` is planned, phase 6. Folders appear with their first code. Each request enters through one
process in `interfaces/`, which checks who is asking, calls a product rule in `domains/`, and
reaches outside systems (Postgres, the PDS, Tap, Matrix, storage, Arachnid, email) only through
`infrastructure/`. Every running process has its own folder, container, database role and network,
so a fault or a compromise in one does not reach the others. `pds-admin` (planned, P2.09) and
`chat-admin` (planned, phase 6) hold the admin credentials. They import nothing but their own
folder, Node built-ins and `shared/admin-envelope/` (planned).

## PDS presentation boundary (ADR 0027)

The approved PDS customization will be a build-only `apps/pds/` presentation package (planned, ADR 0027), not
another running app or account server. It will consume generic `shared/ui` and its declared UI runtime, with no
app/domain/infrastructure/PDS SDK imports, data hooks or authentication logic. The exact upstream frontend owns
routing, guards, hydration, validation, actions, translations and account state; its reviewed presentation
patches live in `deployment/pds/` (ADR 0027): today a CSS theme appended to the upstream stylesheet, built into
the first-party `pds` image. Shared UI remains independent of upstream
router/auth types; generic extensions follow design-sheet registration.

Only the resolved installed `@atproto/oauth-provider-ui/dist` directory and manifest may differ from the pinned
official image. All other contents, modes, paths, symlinks and runtime image configuration remain equal. Provider
asset-serving/CSP source, dependencies, backend APIs, auth/session/data semantics and app scopes stay unchanged.
The optional licensed-font solution is limited to fixed same-origin static delivery and the corresponding HTML
`font-src` adjustment at the existing edge; real-browser feasibility and separate security review precede rollout.

Test-only ephemeral PDS/PLC/mail fixtures may operate without public registrations, real mail or changes to the
operated local/dev topology. They do not replace P2.24's manual dev SMTP checks or P5.12's production recheck.
P2.24's subdivisions allocate boundary/image/CI checks before implementation, with checks, product and edge work
separated under SE-6 as it then stood (ADR 0044 no longer requires the separation). These checks are planned, not implemented by this docs record; current admission checks
remain in force. [ADR 0027](decisions/0027-pds-frontend-distribution.md) defines the exact contract, font gate and
same-backend-version rollback. ADR 0019 still governs merges and Alex's reserved gates.

## Architecture rules and how each is checked

*Checked* means CI fails when the rule is broken. *Planned* names the step that builds the check; until it merges,
review covers the rule. *Review-only* means a person or the PR template checks it, with the reason no tool can.

| Rule | What it says | Checked by |
|---|---|---|
| ADG §1, AB-1 | Folder dependencies form an allowlist matrix; any unlisted edge fails | checked: `MATRIX`, `depcruise_unlisted_edge_fails`, `depcruise_matrix_rows_have_fixtures` |
| ADG §1 | Apps never import each other | checked: `no-app-to-app` |
| ADG §1 | Apps import only `shared/` | checked: `app-only-shared` |
| ADG §1, ADR 0015 | An app's `vite.config.ts` is build-time tooling: it may import Node built-ins, npm, its own app and `shared/`, nothing else | checked: `app-build-config-imports`, `app_build_config_is_tooling` |
| ADG §1, ADR 0015 | Nothing imports an app's `vite.config.ts` | checked: `app-build-config-not-imported`, `app_build_config_is_tooling` |
| ADG §1 | Only the serving interface imports its app's render entry | checked: `app-render-entry-only` |
| ADG §1 | Interfaces never import each other | checked: `no-interface-to-interface` |
| ADR 0056 | In the web process only server files (`*.server.ts`, `hooks.server.ts`, `server.ts`, `lib/server/`) reach a domain or infrastructure; a screen or universal load never does | checked: `svelte-screens-no-core`; for type-only imports in .svelte files, which dependency-cruiser cannot see, `scripts/guards/svelte-imports.ts` (`svelte_type_import_of_core_fails`, `svelte_app_names_no_interface`) |
| ADR 0056 | Only the web process and its screens import Svelte or SvelteKit | checked: `sveltekit-web-only` |
| P1.20t | A web route reaches the database only through an operation in `lib/server`, never by importing `infrastructure/postgres` | checked: `web-routes-no-postgres` |
| ADR 0056 | The web process imports from `apps/web` only the Svelte components (`lib/`), `theme.css`, `app.css` and the `.md` files directly in `legal/`, nothing else | checked: `web-components-only`, `web_process_takes_only_svelte_components_and_icon_data` |
| ADR 0055 | The web process and the Svelte components take only `icons.json` from `shared/ui`, nothing else there | checked: `svelte-no-react-ui`, `web_process_takes_only_svelte_components_and_icon_data` |
| ADR 0056 | No web page is prerendered and no proof-only route exists | checked: `scripts/guards/web-prerender.ts`, `web_prerender_page_export`, `the_build_holds_no_prerendered_page` |
| ADG §1 | `web` (`apps/web`, `interfaces/web`) never imports `admin` | checked: `web-not-admin` |
| ADG §2, AB-1 | Domains do not depend on infrastructure, interfaces or apps | checked: `domain-pure` |
| ADG §1, DC-2 | A domain reaches another domain only through its `index.ts` | checked: `domain-cross-via-index` |
| DC-2, P0.09s | From `apps/`, `interfaces/`, `infrastructure/` or `shared/`, a domain is reached only through its `index.ts` or a file its `package.json` `exports` names | checked: `domain-via-exports` |
| DC-2 | Modules under `infrastructure/` and `shared/` are reached only through their `index.ts` | checked: `infra-shared-via-index` |
| ADG §1 | Domains use no Node I/O built-ins | checked: `domain-no-io-builtins` |
| ADG §1 | No two tracked paths differ only in letter case | checked: `scripts/guards/case-collision.ts`, `case_pair_file_fails`, `case_pair_dir_fails` |
| P2.19b | No tracked text file, docs included, holds a merge conflict marker | checked: `scripts/guards/conflict-markers.ts`, `conflict_in_docs_and_code_fails`, `lookalike_lines_pass` |
| ADG §1 | Product code never imports repository tooling (`scripts/`, `tests/`, configs) | checked: `no-product-imports-tooling` |
| ADG §1, P1.28p | No file outside the tooling set imports one inside it. The set is the Vitest test files, `tests/`, the SE-6 check paths under `scripts/` (not `scripts/ui`), the root `vitest.config.ts`, `fixtures/` and `__fixtures__/` folders, `*.fixture.*`, `*.vector.json` and `*.image.test.*`. It is defined once in `scripts/lint/tooling.ts`, and P1.28m's test-file check reads the same definition (architecture amendments 11 and 11a, 2026-10-08) | checked: `no-product-imports-tooling-set`, `product_never_imports_the_tooling_set` |
| ADG §2 | Infrastructure implements domain contracts and never reaches an entry point | checked: `infrastructure-not-entry` |
| AB-2 | Adapters are built only in the process's composition root (`main.ts`/`compose.ts`; in the web process `src/hooks.server.ts`/`src/lib/server/compose.ts`) | checked: `scripts/guards/composition-root.ts`, `composition_root_split`, `composition_root_kit_hooks`, `composition_root_kit_server`, `composition_root_examines_the_web_entries` (each entry file imports nothing from infrastructure, and one that wires services imports its compose.ts once); `domain-pure` keeps adapters out of domains. Review-only: `MATRIX` lets an interface import infrastructure, and no tool tells construction from use |
| AB-2 | A port exists only for I/O or non-determinism | review-only: no tool can tell why an interface exists |
| ADG §1 | `shared/` leaf folders import nothing product-specific | checked: `shared-leaf` |
| ADG §1 | `pds-admin` and `chat-admin` import only themselves, Node built-ins and the zero-dependency allowlist | checked: `admin-services-zero-deps`, `depcruise_allowlist_exact` |
| ADG §1 | A folder on the zero-dependency allowlist obeys the same rule | checked: `allowlist-zero-deps` |
| ADG §1 | A vendor SDK is imported in one adapter folder per runtime | checked: `vendor-sdk-one-adapter` |
| plan §5.4 | net-guard imports only Node built-ins, undici and its own files; its *.test.ts may also import fast-check and vitest | checked: `net-guard-leaf` |
| ADG §2, P1.28g | No `deployment/edge/` file, tests included, imports `deployment/preflight/`: the edge is trusted base and the preflight is product (architecture amendment 8 item 2, 2026-10-08) | checked: `edge-not-preflight`, `edge_never_imports_preflight`, `edge_not_preflight_is_one_way` |
| ADG §1, P1.31d | The cruise reads package `exports` maps (conditions `import`, `require`, `node`, `default`) and skips only our own build and scratch trees, never anything under a `node_modules/`, so every package import reaches the rules and a subpath a package does not export is a finding | checked: `exports_only_package_resolves`, `exports_unexported_subpath_is_a_finding`, `package_dist_entry_is_checked` |
| ADG §1, P1.31d | The lexicon build scripts (`shared/lexicons/scripts/`) import only their own package, npm and exactly `node:fs`, `node:path`, `node:os`, `node:url` and `node:child_process`; no file outside them imports one, tests included (architecture record 2026-10-12-p131-depcruise-and-lexicon-choices item 2) | checked: `MATRIX` (its shared-lexicons-scripts row), `lexicon-scripts-not-imported`, `lexicon_scripts_row_is_narrow` |
| ADG §1, P1.28k | Every relative or `@unset/*` import resolves, with no exception since P1.20k deleted the React render build (architecture amendment 8, second note, 2026-10-08) | checked: `specifier-must-resolve`, `unresolved_imports_fail`, `no_unresolved_exception_remains` |
| ADG §1, P1.28k | Every import is spelled `./` or `../`, `@unset/<workspace>`, `node:<built-in>`, or a package its own workspace declares (the root package.json for root-level files, and for test files anywhere: P1.28m); never root-absolute, a URL scheme, a backslash, `#`, or the root package's own name (architecture amendment 10, 2026-10-08) | checked: `scripts/lint/specifiers.ts`, `real_tree_uses_only_allowed_specifiers`, `root_only_packages_only_in_test_files` |
| ADG §1, P1.28k | No package.json reroutes an import: the root has no `exports`, `imports`, `main`, `module` or `browser`, each workspace's targets stay inside it, no tsconfig declares `paths` or `baseUrl`, and no tracked file sits in a folder the cruise skips (architecture amendment 10 item 2, 2026-10-08) | checked: `scripts/ci/package-routes.ts`, `real_tree_has_no_rerouting` |
| TE-1 | Fakes are used only in tests and in non-production composition roots | checked: `fake-only-in-composition-root`, `fake_boot_refused_in_prod` |
| DC-1 | No dependency cycles | checked: `no-circular` |
| DC-1 | No orphan modules | checked: `no-orphans` |
| DC-1 | Modules are deep; functions do one job | review-only: no tool measures depth |
| AB-3 | A new process, role or orchestrator needs an ADR naming its driver | review-only: the driver is a judgement; backed by the grant-matrix test for roles and ADR 0011 for orchestrators |
| AB-4 | Every guard proves it examined more than zero items and fails on a known-bad fixture | checked: `scripts/guards/guards.test.ts`, `depcruise_cruised_nonzero` |
| DM-2 | Transactions are opened only in `infrastructure/postgres/tx.ts` | checked: `transactions_only_in_tx` (Semgrep rule transactions-only-in-tx, proven on fixtures by the CI semgrep job) |
| DA-1 | `idx` can be dropped and rebuilt without losing a decision | planned: P3.03 |
| SE-4 | Every route names a rate-limit policy in its own interface's `limits.ts`, or is "exempt" on a static route | checked: `every_route_has_a_policy` and `only_health_skips_the_rate_limit` (tests/integration/web/gate.test.ts): every SvelteKit route has a policy file, whose type takes only a policy name defined in interfaces/web/src/lib/server/limits.ts, and only /health, a static route, skips the limit. The web process only: a later process that is not SvelteKit (media, api, indexer) needs its own route-policy check when it lands |
| SE-6 | A PR that changes a trusted-base path, a check path among them, carries the `security-review` label (ADR 0044); the review of the exact head, and Alex's line for a loosening, are review-only | checked: `trusted_path_needs_label`, `renovate_needs_label_too`, `trusted_paths_named`, `trusted_base_list_from_codeowners`, `list_is_union_of_base_and_head` |

The docs test (P0.09, `architecture_rule_table_matches_depcruise`) reads this table. It fails if a named check
does not exist, a `forbidden` rule or `MATRIX` has no row, a planned step has already merged, or a review-only row
has no reason.

## Views

What runs today is dependency-cruiser's forbidden-edge rules and the allowlist matrix in
`scripts/lint/.dependency-cruiser.cjs` (dependency-cruiser 18.7.0). The CI `code` job's
`npm run lint` step (`.github/workflows/ci.yml`) runs `depcruise` on that config (`package.json`);
the required `check` job fails unless `code` succeeded.
An edge the matrix does not list fails as `not-in-allowed`.

The generated module view and its CI diff check are planned (AB-4, PARTLY, phase 2). AB-4 in
[`engineering/engineering-rules.md`](engineering/engineering-rules.md) gives the enforcement as
"CI regenerates the module view and fails on a diff." The rule's status is PARTLY. Each view is
priority P2, when its first process exists.

- **Module view:** the folder dependency graph, planned (AB-4, PARTLY, phase 2).
- **Runtime view:** the processes, their database roles and the networks each may reach, checked
  against the Compose file and the grant matrix.
- **Deployment view:** hosts, edge and what is public (only 443 and 80), checked against the
  deployment preflight.

## Where to read next

- Feature ownership paths: `docs/human/features/`.
- Why a decision was made: `docs/human/decisions/`.
- Words we use: `docs/human/glossary.md`.
