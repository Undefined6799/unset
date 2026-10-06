# Engineering Rules (unset.sh)

Status: **ADOPTED** by Alex 2026-10-04 12:56Z ("Adopt all" card: the 48 rules with the recommended option for each of D1-D9). DO-3 added 2026-10-05 at Alex's request (rule 49). Rationale, cuts and changelog: `../architecture-handoff/engineering-rules-rationale.md`.

These rules sit beside the four guidelines in `engineering/` and never weaken a security or privacy decision in the plan. Where a rule and the plan disagree, the plan wins. Where a rule and the ADG disagree on structure, the ADG wins.

**How to read a rule.** Each rule has an id and one imperative sentence. Below it:
- **Enforced by**: a CI tool, a guard in `scripts/guards/`, the PR template (DL-3), or *review-only* with a reason.
- **Source**: book and chapter. Editions are given where chapter numbers differ between editions. Web articles carry their URL.
- **Status**: NEW, PARTLY (pointer to the part already covered), or COVERED (pointer; kept because other rules lean on it).
- **Priority**: **P1** adopt now; **P2** adopt at the trigger named after "when".

Security checks run from the first commit (ADG §9 [A3]). Every other guard or CI job lands when its trigger arrives, never earlier (handoff §5, §9). Biome rule names marked *(unverified)* must be confirmed in the pinned Biome 2.5 schema at P0.05 before they are switched on.

Abbreviations: **ADG** architecture-and-development-guideline; **AI** architecture-instructions; **EPA** engineering-practices-addendum; **EW** engineering-workflow-and-change-management; **Plan** unset-sh-rebuild-plan; **README rule N** = `breakdown/00-README.md`; **P*n.nn*** = a step-book step; **F-nn** = a finding in `step-book-findings.md`. Book short names are listed under Sources.

---

## Top 15

The rules that matter most for the first slice (sign in, see your own profile). Of this rules file, CLAUDE.md imports this Top 15 page only (alongside the four guideline documents); the full set is read on demand.

1. **AB-1** Folder dependencies form an allowlist matrix in dependency-cruiser, and any unlisted edge fails. [Clean Architecture ch. 22]
2. **AB-2** Ports exist only for I/O and non-determinism, and adapters are built only in the composition root. [Clean Architecture ch. 26]
3. **DM-1** Every external input is parsed once at the boundary into branded types, and domains never take a bare `string`. [Effective Java Item 49]
4. **DC-4** Expected failures are typed results, and no error is ever swallowed. [Effective Java Items 69, 77]
5. **SE-1** Every `[SEC]` step starts with a one-screen Threats section, and its PR updates the ASVS rows. [Shostack ch. 1]
6. **SE-2** Every id is resolved against `viewer`, hidden reads as missing (private profiles too, D7), and every route ships with a denial test. [OWASP API1:2023]
7. **SE-3** Clients receive only explicit view types, and each output context has a single encoder. [OWASP API3:2023]
8. **SE-7** Logs carry only allowlisted fields: never a DID, IP, handle or token. [SRE ch. 6]
9. **DA-1** Every fact we decide lives in an app-owned schema, and `idx` can be dropped and rebuilt. [DDIA 1st ed., Part III]
10. **DA-4** Each read-decide-write names its concurrency mechanism, and no network I/O runs inside a transaction. [DDIA 1st ed. ch. 7]
11. **RE-1** Every request has a deadline, timeouts nest inside it, and retries happen at one layer only. [SRE ch. 22]
12. **TE-1** No module mocks, and only unmanaged dependencies get doubles. [Khorikov ch. 5]
13. **TE-2** Tests that touch data run against real Postgres, connected as the real per-process role. [Khorikov ch. 10]
14. **TE-5** Every test is written first and shown failing. [Beck TDD ch. 25]
15. **DL-1** One step per PR, under about 400 lines, with refactoring and behaviour changes in separate commits. [Accelerate ch. 4]

---

## 1. Design and code

**DC-1. Make modules deep and size functions by what a reader must hold in mind. Split code where knowledge changes, never by the order steps run. Split a function only when the extracted piece has a name that lets the caller stop reading. Inline any layer that only forwards.**
- Enforced by: review-only (no tool sees depth). Biome `noExcessiveCognitiveComplexity` at warn *(unverified)*. The 300-line file warning stays. File and module line budgets (P0.05) are warnings that prompt a reviewer to look, never a target: tests and `*.fake.ts` do not count, and a module may grow past its budget when splitting it would make it harder to read, with the reason recorded in the budget file next to the raised number (Alex, 2026-10-05: simple, readable, easy to maintain beats staying under a number).
- Source: APoSD 2nd ed. — ch. 4–7, ch. 9; Code Complete 2nd ed. — ch. 7 (§7.4); Refactoring 2nd ed. — ch. 3 (Middle Man, Shotgun Surgery); Pragmatic Programmer — Topics 9–10.
- Status: PARTLY — AI §8–9, §12; ADG §2–3. README rule 3 reworded to match (D1, adopted).
- Priority: P1

**DC-2. Reach every module under `domains/`, `infrastructure/` and `shared/` only through its `index.ts`, tests included. Give each export a doc comment stating what its signature cannot: units, invariants, errors and security assumptions. Give each domain a README of at most 20 lines.**
- Enforced by: dependency-cruiser `no-deep-import`, including tests. A doc-comment guard (`/**` before each export in `*/index.ts`). A guard that every `domains/*` folder has a README.
- Source: APoSD 2nd ed. — ch. 4–5, 12–13, 15; Effective Java 3rd ed. — Item 15; Practice of Programming — ch. 4; Team Topologies — ch. 3 (team API); Documenting SA 2nd ed. — ch. 7.
- Status: PARTLY — README rules 2–3, 6–7; ADG §2.
- Priority: P1 for the import ban. P2 for both guards, when `domains/` gets its second folder.

**DC-3. Write plain TypeScript:**
- model state as discriminated unions with an exhaustive `switch` ending in `assertNever`;
- make product decisions pure functions over `readonly` data;
- inherit only from `Error`;
- keep mutable module state only in a composition root;
- use pattern names only in their TypeScript form.
- Enforced by: `tsc` (`assertNever(x: never)`). `noFallthroughCasesInSwitch` (on). Biome `useConst` and `noParameterAssign` *(unverified)*. A Semgrep rule for `extends` other than `Error`/`AppError`, and for top-level `let`/`new Map(` outside `interfaces/*/main.ts`.
- Source: Effective Java 3rd ed. — Items 17–19, 23; GoF — ch. 1; Khorikov — ch. 6 (functional architecture); Evans DDD — ch. 10; Refactoring 2nd ed. — Global Data, Mutable Data.
- Status: PARTLY — README rules 1, 4, 8; AI §7; P1.02 (frozen config).
- Priority: P1

**DC-4. Return expected failures as typed results carrying an error-catalog code, and throw only for bugs and infrastructure faults. Translate errors at each module boundary. Never swallow an error: no empty `catch`, no `catch` that ends in success, no floating promise. Idempotent deletes and unlikes succeed silently; auth, CSRF, scope and verification failures always deny visibly.**
- Enforced by: Biome `noEmptyBlockStatements` and `noFloatingPromises` *(unverified; if `noFloatingPromises` is still nursery in 2.5 or misses cases, a Semgrep rule)*. A Semgrep rule for a `catch` that returns `ok: true`. The plan's A10 middleware test.
- Source: Effective Java 3rd ed. — Items 69, 73, 77; Practice of Programming — ch. 4; APoSD 2nd ed. — ch. 10; Release It! 2nd ed. — Stability Patterns (Let It Crash, for bug paths only).
- Status: COVERED in substance by README rule 8, P1.03 and Plan §6.1 A10. The Semgrep rule and the boundary translation are NEW.
- Priority: P1

## 2. Architecture and boundaries

**AB-1. Write the ADG §1 dependency rules as an allowlist matrix in `scripts/lint/.dependency-cruiser.cjs`, so any edge it does not list fails. It must cover all of these:**
- one vendor-SDK adapter folder per runtime;
- interfaces never import each other;
- only the serving interface imports its app's render entry;
- `domains/` imports only its own contracts, other domains' `index.ts`, `shared/errors`, `shared/config` types and `shared/lexicons` (the one record validator, called on the write path; its `@atproto/lex` dependency is the single npm exception); no Node I/O built-in and no other npm package;
- the zero-dependency allowlist changes only with Alex's approval.
- Enforced by: dependency-cruiser, with one fixture per matrix row, extending P0.05 (`vendor-sdk-only-in-infrastructure`, `depcruise_sdk_adapter`, `depcruise_no_interface_to_interface`, `depcruise_app_render_entry`, `depcruise_allowlist_exact`, `depcruise_allowed_edges`).
- Source: Clean Architecture — ch. 14, ch. 22; FoSA 1st ed. ch. 6 / 2nd ed. ch. 11; Evans DDD — ch. 14 (anticorruption layer); Fairbanks — ch. 10.
- Status: PARTLY — ADG §1–2, Plan §7, P0.05 (the allowlist and allowed-edges fixtures already exist). NEW: the full matrix and the ban on Node I/O in domains.
- Priority: P1

**AB-2. Declare a domain port only for I/O or non-determinism (database, network, storage, clock, randomness, keys). Build its adapter only in the process's composition root and pass it in. This covers the read-query functions in `infrastructure/postgres/queries/`. Pages take a plain view model that the serving interface maps onto.**
- Enforced by: dependency-cruiser (inside `interfaces/<x>/`, only `main.ts`/`compose.ts` imports `infrastructure/**`). Review question: "is this port I/O or non-determinism?"
- Source: Clean Architecture — ch. 23 (Humble Objects), ch. 24, ch. 26 (The Main Component); Cosmic Python — ch. 3, ch. 12, ch. 13; Evans DDD — ch. 4 (Smart UI).
- Status: PARTLY — ADG §1 ("UI only"), AI §7, §9, Plan §5.2 (`api` read-only role).
- Priority: P1

**AB-3. Add a process, container, database role or orchestrator only through an ADR that names its driver: security isolation, fault isolation, or a resource limit. Never merge an existing isolation boundary. Kubernetes, service mesh, autoscaling and multi-region wait for a measured need beyond one host that Compose with `docker-rollout` cannot meet.**
- Enforced by: ADR (DO-1). The grant-matrix test catches undeclared roles. An orchestrator PR must cite the trigger.
- Source: Hard Parts — ch. 3, ch. 7; Building Microservices 2nd ed. — ch. 1, ch. 3; Production Kubernetes — ch. 1.
- Status: PARTLY — ADG §1–2, Plan §5.2. NEW: the driver-naming ADR and the orchestrator trigger.
- Priority: P1

**AB-4. Keep `docs/human/architecture.md` to these sections:**
- the ranked driving characteristics (adopted 2026-10-04: security and privacy; evolvability by AI authors; operational simplicity on one host);
- a table marking each architecture rule as *checked* (naming the check) or *review-only* (with a reason);
- the module, runtime and deployment views, generated or checked from source.

**A guard must prove it examined more than zero items, and it must fail on a known-bad fixture.**
- Enforced by: the docs test (P0.09) parses the rule table and checks that each named check exists. One Vitest per guard, with a bad fixture. CI regenerates the module view and fails on a diff.
- Source: FoSA 1st ed. — ch. 4–6 (fitness functions), ch. 19 (2nd ed. ch. 21); Documenting SA 2nd ed. — Prologue (rule 6); SE@Google — ch. 20.
- Status: PARTLY — ADG §6, §11; AI §20, §22; P0.04/P0.05 (`depcruise_cruised_nonzero`).
- Priority: P1 for the characteristics and the table. P2 for each view, when its first process exists.

## 3. Domain model

**DM-1. Parse every external input once at the boundary into branded types: request, Tap event, env, and every upstream response (size- and time-capped). The brands are `Did`, `Handle`, `VerifiedHandle` (minted only by `verifyHandle`), `AtUri`, `Cid`, `Rkey`, `SafeReturnPath` and so on. `as <Brand>` appears only in that brand's parser.**
- Enforced by: `tsc` (erasable brands). A Semgrep rule for `as <Brand>` outside its owning file. A property test per parser (TE-6). A malformed-response fake per adapter (TE-3).
- Source: Effective Java 3rd ed. — Items 1, 49; Refactoring 2nd ed. — Replace Primitive with Object; Code Complete 2nd ed. — ch. 8 (barricades); Cosmic Python — Appendix E; OWASP API10:2023.
- Status: PARTLY — Plan §2 rules 1, 5, 8, 13; EW §4. NEW: an unforgeable `VerifiedHandle` and parsing of upstream responses.
- Priority: P1 (upstream-response fakes P2, when: first adapter beyond PDS/PLC)

**DM-2. Define repositories only for aggregates, named in domain words. Every per-account method takes the caller's `Did` as a SQL predicate. The use case owns the transaction. A core state change is one guarded `UPDATE … WHERE state = $expected` (zero rows means a conflict). Call Postgres invariants (`core.is_held`, `eraseDid`); never re-implement them.**
- Enforced by: Semgrep (`BEGIN`/`COMMIT`/`.transaction(` only in `infrastructure/postgres/tx.ts`). One cross-account integration case per repository. Each phase's refine step labels its features core, supporting or generic, one line per phase.
- Source: Evans DDD — ch. 6, ch. 15; IDDD — ch. 2 (subdomains), ch. 12; Cosmic Python — ch. 2, ch. 6; Hard Parts — ch. 6.
- Status: PARTLY — AI §9, §15; `breakdown/02-shared-blocks.md` (one hold predicate, `core.is_held`). NEW: the `Did` parameter and transaction ownership.
- Priority: P1 (the state-pair table test only for the upload machine, Phase 4)

**DM-3. Use one glossary word per concept, spelled the same in code, SQL, routes, logs and UI keys. Qualify words that mean different things in different places (session, account, profile, report, review). Never name anything Helper, Manager, Utils or Wrapper. Names like ADG §13's `MessageService`, `MessageRepository` and `MatrixMessageGateway` name modules or plain objects, never classes.**
- Enforced by: a banned-name guard. A glossary guard checks domain exports, stored enum values and audit event names against `docs/human/glossary.md` (warn first).
- Source: Evans DDD — ch. 2; DDD Distilled — ch. 2; Clean Code — ch. 2; Code Complete 2nd ed. — ch. 11; Pragmatic Programmer — Topic 44.
- Status: PARTLY — ADG §4, §13; AI §10; README rule 5.
- Priority: P1 for banned names. P2 for the glossary guard, when Phase 1 exits.

## 4. Data and consistency

**DA-1. Keep every fact we decide (moderation, delist, suspension, tombstones, track requests) in an app-owned schema, and treat `idx` as derived data that can be dropped and rebuilt. No foreign key crosses into `idx`. Store network references as typed columns with no foreign key.**
- Enforced by: the integration test `idx-rebuild-preserves-decisions`. A `pg_catalog` test that no foreign key enters `idx`. The erasure-coverage test.
- Source: DDIA 1st ed. — Part III introduction, ch. 12; Database Internals — Anti-Entropy and Dissemination; SQL Antipatterns — Keyless Entry, Polymorphic Associations.
- Status: PARTLY — Plan §2 rule 12, §5.2; P3.03 keeps moderation state in `mod.account_state` (F-01 fixed).
- Priority: P1

**DA-2. Run effects that must outlive the request from a job or outbox row committed with the decision: email, the MAS seed, Arachnid, `pds-admin` verbs, the post-review publish, and multi-step cross-system writes. User-initiated PDS writes stay synchronous. Every write must survive a lost reply: choose rkeys before the call, use `swapCommit`, read and compare CIDs, and put a submission id on create forms.**
- Enforced by: P2.07's static guard. A fault-injection Vitest on the fake PDS (`commit-then-timeout-writes-nothing-on-resume`, `double-submit-creates-one-record`). The same outbox row twice gives one effect. Any new job that restores a user's OAuth session is a `[SEC]` change and needs an ADR.
- Source: DDIA 1st ed. — ch. 11, ch. 12 (end-to-end argument); Understanding Distributed Systems 2nd ed. — ch. 5, ch. 13; API Design Patterns — ch. 26; Release It! 2nd ed. — Integration Points.
- Status: PARTLY — Plan §5.4 (synchronous `applyWrites`), §5.8 (the only server-side session restore), P2.18, P2.22, P2.23. NEW for likes, follows, reports and internal verbs (F-04).
- Priority: P1, when: first PDS write (Phase 2)

**DA-3. Order events by `rev`, TID or sequence, never by timestamp. When events about one subject arrive out of order, apply the restrictive state at once and the permissive state only after the source of truth confirms it. Use database `now()` for persisted times and the injected clock otherwise. A network `createdAt` never decides a security or moderation outcome.**
- Enforced by: one reordering test per state machine. A Semgrep rule bans `Date.now()` and argument-less `new Date()` outside the clock in `shared/` and tests. Deploy preflight refuses a clock offset above 1 s.
- Source: DDIA 1st ed. — ch. 8 (Unreliable Clocks), ch. 9 (Ordering Guarantees); Understanding Distributed Systems 2nd ed. — ch. 8; Khorikov — ch. 11.
- Status: PARTLY — P3.04 (`reordered-status-events-fail-closed`), P3.06, README rule 1, P1.16.
- Priority: P1 (`createdAt` clamp with the Phase 4 feeds; offset check at P5.00)

**DA-4. Name the concurrency mechanism of every read-decide-write: a conditional statement, a constraint, `FOR UPDATE`, an ordered advisory lock with `lock_timeout`, or `SERIALIZABLE` through the one retry wrapper. Claim jobs with `SKIP LOCKED` in a short transaction, fence them with a `lease_token`, and do no network I/O while holding a transaction, pool connection or lock.**
- Enforced by: a race test per mechanism (exactly one winner). `stale-lease-holder-cannot-write`. A config test that max step timeout < lease. A Semgrep rule for an awaited network call inside `withTransaction(`. Two named exceptions: the OAuth `requestLock`, and a run-once process's singleton advisory lock, held on its own dedicated connection outside the pool.
- Source: DDIA 1st ed. — ch. 7 (lost updates, write skew), ch. 8 (fencing tokens); Database Internals — Transaction Processing and Recovery; Burns — Work Queue, Ownership Election; OSTEP — ch. 32.
- Status: PARTLY — EW §5, P1.16, P1.17, P2.22, P3.05. NEW: fencing (F-02).
- Priority: P1

**DA-5. Keep migrations expand-then-contract. A contract migration ships only after no deployed release references the object, and its header names that release. Large backfills run as batched jobs. New foreign keys and CHECKs on existing tables go in `NOT VALID` and are validated later.**
- Enforced by: a migration lint (`-- phase: contract` header, `NOT VALID`).
- Source: DDIA 1st ed. — ch. 4; Continuous Delivery — ch. 12; Release It! 2nd ed. — Design for Deployment.
- Status: COVERED for expand-then-contract (Plan §5.2, P1.11, P5.03). The three additions are NEW.
- Priority: P2, when: the first migration on a table that already holds data

**DA-6. Store each network record verbatim in `jsonb`, and promote anything queried, joined, erased or authorised to a typed, constrained column. Guard columns are NOT NULL, or have a tested NULL case. Name every selected column (no `SELECT *`, no `RETURNING *`). Never let an `int8` pass silently through a JS `number`.**
- Enforced by: a Semgrep rule over SQL (no `*`; warn on `->>` in WHERE under `domains/`/`interfaces/`). A `pg_catalog` NOT NULL test. A test of the `pg` type parser.
- Source: DDIA 1st ed. — ch. 2, ch. 4; SQL Antipatterns — Entity-Attribute-Value, Implicit Columns; CS:APP 3rd ed. — ch. 2.
- Status: PARTLY — Plan §6.1, P3.03. NEW: the guard-column rule (F-03).
- Priority: P1

## 5. Reliability

**RE-1. Give every request handler an overall deadline, combined into every outbound call's signal. Nest every timeout inside its caller's budget: pool acquire, `statement_timeout`, `lock_timeout`, PDS call < request < edge. Retry only idempotent calls, at exactly one layer, through one `retry()` helper in `shared/` that uses capped jittered backoff and honours `Retry-After`.**
- Enforced by: P1.04's `c.var.deadline`. A static test that adapter calls pass a `signal`. `pool_exhaustion_fails_fast`. A config-inequality test. A Semgrep rule bans hand-written retry loops.
- Source: SRE — ch. 21–22; Release It! 2nd ed. — Timeouts, Dogpile; Understanding Distributed Systems 2nd ed. — ch. 27; API Design Patterns — ch. 29.
- Status: PARTLY — net-guard caps, Plan §6.1, P1.11, P1.12, P3.05. NEW: the deadline and the acquire timeout (F-08, F-09).
- Priority: P1. The first slice needs the PDS/PLC deadline and the timeouts; the shared `retry()` helper waits until there is a second retrying caller.

**RE-2. Contain each dependency:**
- give it a concurrency cap built in the composition root (excess fails fast with `dep.saturated`);
- bound every queue, buffer and multi-row `SELECT`, and push back when full;
- let a failing dependency degrade only its own feature (a broken feed tab still lets the profile render; an Arachnid outage pauses uploads but not reads).
- Enforced by: a small semaphore in `shared/` (no dependency). `slow_dependency_does_not_starve_others`. One degrade test per dependency in the TE-3 fake set. A Semgrep rule flags `SELECT` without `LIMIT` (opt out with `-- bounded:`).
- Source: Release It! 2nd ed. — Bulkheads, Unbounded Result Sets, Create Back Pressure; SRE — ch. 22; Understanding Distributed Systems 2nd ed. — ch. 28.
- Status: PARTLY — Plan §2 rule 11, §5.2, P3.05, P5.07b, P5.08d. NEW: graceful degradation.
- Priority: P2, when: `web` first calls a second dependency on a request. Circuit breakers only where the plan already defines fail-closed behaviour.

**RE-3. Give everything that grows a purge and a size alert: tables, logs, object prefixes, WAL, Tap's database. Every stored object is owned by a row or a per-DID prefix. The reaper and retention jobs stop and alert when a run would exceed a set count or percentage.**
- Enforced by: a CI test that every table appears in the retention matrix. A weekly orphan sweep. `governor_stops_mass_delete`. A disk-over-80 % alert.
- Source: Release It! 2nd ed. — Steady State, Governor; SRE — ch. 26; SQL Antipatterns — Phantom Files.
- Status: PARTLY — Plan §6 retention, P5.03, P5.09.
- Priority: P2, when: the first retention job (P5.09)

**RE-4. Report per service the four golden signals plus saturation (event-loop delay, heap, pool waiters, queue depth, disk) through `ops.report()`, never per user, with retention set in the retention table and the RoPA. Alert only on symptoms a person must act on, stream silence included, and name the runbook step in each alert.**
- Enforced by: each composition root registers a reporter. A test that metrics carry no DID, IP or handle. A test that every `alert.send` class is in the runbook index. A heartbeat test `tap_stall_detected`.
- Source: SRE — ch. 6, ch. 10; Release It! 2nd ed. — Transparency, Handshaking; Systems Performance 2nd ed. — ch. 2 (USE); SRW — ch. 5.
- Status: PARTLY — EPA §6, admin design §11.4, Plan §2 rule 25, P3.02. `ops.metric` fits decision 17 (D9, adopted).
- Priority: P2, when: the second running process. Alert wording (review-only): an alert that fires twice with no action is fixed or deleted.

**RE-5. Write a blameless postmortem within 7 days of every sev-1/sev-2 incident, rollback, data-loss near miss or failed restore drill, as `docs/human/runbooks/postmortem-<date>-<slug>.md`, with no user identifiers.**
- Enforced by: a template file. The fix PR links its postmortem (review).
- Source: SRE — ch. 15; SRW — ch. 10; DevOps Handbook — Part V.
- Status: PARTLY — Plan §6, admin design §8.1 (legal incident duties).
- Priority: P2, when: the closed test starts

## 6. Security and privacy

**SE-1. Before building any `[SEC]` step, and in every `P<n>.00`, write a one-screen Threats section containing:**
- a data-flow diagram with trust boundaries;
- STRIDE per boundary-crossing element;
- LINDDUN for new personal data.

**Each threat ends as a named test, an existing control, or a risk Alex accepts by name. The PR updates the matching ASVS 5.0 rows.**
- Enforced by: a required `Threats:` heading in the `[SEC]` step template. PR template fields (DL-3). A CI check that every test id in `docs/human/compliance/asvs-5-l2.md` exists and ran.
- Source: Shostack — ch. 1, 3, 7, 10; OWASP Top 10:2025 — A06; OWASP ASVS 5.0 — V1–V17.
- Status: PARTLY — admin design §10, Plan §6.1. NEW: per-slice threat models (F-26).
- Priority: P1

**SE-2. Resolve every identifier a route accepts through a domain function taking `viewer: Did | null`. Answer missing, not-yours, deactivated, delisted and taken-down identically (`AccountUnavailable`), and keep hidden subjects out of counts and lists. Ship every route or guard change with a denial test. Private profiles answer the same way too (D7, adopted): `ProfilePrivate` is folded into `AccountUnavailable` for anyone but the owner.**
- Enforced by: the signature convention. A Vitest per read route over the account states. P2 adds a cross-user authorization matrix generated from the route manifest (SE-4).
- Source: OWASP API Security Top 10:2023 — API1, API3, API5; OWASP Top 10:2025 — A01; Anderson 3rd ed. — ch. 11; Khorikov — ch. 8.
- Status: PARTLY — CLAUDE.md, admin design §11.1, Plan §5.4, phase-3 `AccountUnavailable` (P3.10, P3.12; `ProfilePrivate` folded in by D7).
- Priority: P1 for denial tests. P2 for the matrix.

**SE-3. Return only explicit view types built field by field; never a row, a spread row or an upstream response. Send user data through the single encoder for each context: React, `safeHref`, the island serialiser, or a header encoder that rejects CR/LF. Parse URLs once with WHATWG `URL`. Isolate bidi text (`dir="auto"`, `<bdi>`), and strip override and embedding controls only in identifiers and handles.**
- Enforced by: Biome `noDangerouslySetInnerHtml` (exists). Semgrep rules for `c.json(row`/`...row` in `interfaces/`, a non-constant `c.header(`, and string methods on url/origin/host values. A fuzz test of the identifier sanitiser.
- Source: OWASP API Security Top 10:2023 — API3; The Tangled Web — ch. 2–5, ch. 13; OWASP ASVS 5.0 — V1, V14; Shostack — ch. 13.
- Status: PARTLY — Plan §2 rules 5, 13, 15, §5.1 (serialiser), §5.4. NEW: view types, headers and bidi.
- Priority: P1 (bidi part P2, when: the first user-supplied display text)

**SE-4. Generate each entrypoint's routes from one checked-in manifest recording method, path, auth, CSRF, rate-limit class, body limit and CSP group, so every new route appears as a manifest diff.**
- Enforced by: a manifest-equals-router Vitest per entrypoint.
- Source: OWASP API Security Top 10:2023 — API9.
- Status: PARTLY — admin route manifest (admin design §11.1), the Plan §2 rule 14 static CSRF test.
- Priority: P2, when: `web` grows past the first slice's routes, or `api` lands

**SE-5. Bind every token we mint to issuer, audience, purpose, a short expiry and, where replay matters, a single-use id, all inside the signed bytes. A privileged internal service acts only on signed proof of the end actor's intent, or on one fixed verb with its own quota, never just because the caller is `web`.**
- Enforced by: a negative Vitest set per token type (wrong audience or purpose, expired, replayed, swapped field). The ADR template field "what proves intent?".
- Source: Anderson 3rd ed. — ch. 4, ch. 6; OWASP ASVS 5.0 — V9; Building Microservices 2nd ed. — ch. 11.
- Status: PARTLY — Plan §5.2 (`pds-admin` envelopes), §5.6, §6.1. NEW: the general rule and new tokens such as media URLs.
- Priority: P1

**SE-6. Keep a written list of the trusted base, and make a PR that changes it change nothing else. The list:**
- CSRF gate and session;
- `verifyHandle`, `net-guard`, serialiser and `safeHref`;
- seal, the CSP builder, media sandbox headers;
- roles and grants on what already exists: a new role, a change to a role's attributes, a grant widened or narrowed on an existing table, column, function or schema, default privileges and row-level policies (the role roster `roles.json` whole, or a migration or `grant-matrix.json` entry); a grant on a schema always counts; any change to an existing function or view (`CREATE OR REPLACE` of its body or definition, or `ALTER` of its `SECURITY`, owner or `search_path`); functions the trusted base names (the `eraseDid` family, `audit/` append, the legal-hold definers including `core.is_held`) count even when new, through a named list beside the CODEOWNERS trusted-base section; an `ADD COLUMN` to an existing table counts unless every grant-matrix entry for that table lists its columns or is marked `wholeTable`, and setting or clearing `wholeTable` counts. `wholeTable` is allowed only on a table with no personal data (no row in `erasure-registry.json`); a table with personal data is granted by column list, and no role has default privileges that reach it;
- `audit/` append, `eraseDid` and existing rows of `erasure-registry.json`;
- `shared/http/` (the mechanisms; route rate-limit policies live with their interface, not here), `shared/admin-envelope/`, `pds-admin`, `chat-admin`, `chat-auth`;
- the lexicons and permission set in `shared/lexicons/`, the legal-hold seal path and its offline export CLI `interfaces/legal-hold-export/`, and `deployment/edge/`;
- the checks themselves. A *check path* is anything that decides whether CI passes: the `scripts/` folders whose code decides pass or fail (`guards/` with fixtures, `lint/` (Semgrep rules in `lint/semgrep/` and the dependency-cruiser config), `ci/`, `budgets/`, `licence/`, `docs/`, `githooks/`, and each later check folder, listed when created; generators and dev tools such as dev-seed are not check paths, and a test fails if `ci.yml` or the `check` script runs a `scripts/` file outside a listed check folder), `.github/` (workflows, CODEOWNERS, labels, required checks) and the root `.semgrepignore`, which stays at the root because Semgrep's default ignores differ without it (root tidy, Alex 2026-10-05 03:01Z, merged as #42), and the root `vitest.config.ts` and `biome.json`, which set what runs and what fails (`retry`, `allowOnly`, `passWithNoTests`, `include`, lint rules; ruling 2026-10-06); CODEOWNERS lists them on a machine-read `# checks:` line beside `# parsed:`. A *product path* is `apps/`, `interfaces/`, `domains/`, `infrastructure/`, `shared/` and `deployment/`. A PR that touches a check path touches no product path; it may carry tests, fixtures, `docs/` (human and ai) and repo config such as `.github/renovate.json`. Documentation inside a product folder (a regular file, git mode 100644, named `*.md` or exactly `LICENSE`, `LICENSE.md` or `LICENSE.txt`, or a `package.json` diff that changes only the `license` key) does not make a PR a product PR; a symlink never counts as documentation. A test file takes the class of the folder it sits in: a `*.test.ts` under a check folder is a check path. CI on `pull_request` runs the PR's own copy of the checks, so no check can defend against a PR that edits it: keeping check changes apart from the code they judge lets human review see the weakening on its own (ruling 2026-10-05, refined 01:15Z). A step that needs both becomes two, the check part first as `<id>q`. Enforced from P0.09c onward; earlier PRs are review-only.
- Rides with its feature step instead (still CODEOWNERS security-reviewed, not isolated): a migration that creates new tables, columns, views, sequences or functions, the `grant-matrix.json` entries that grant on those new objects only, and new `erasure-registry.json` rows for columns the same PR creates. A new view or function that reads a table the PR does not create rides with the feature only when it runs with its caller's rights (a view `WITH (security_invoker = true)`, a function `SECURITY INVOKER`), so the reading role still needs its own column grants in the matrix; a new `SECURITY DEFINER` function or a view without `security_invoker` over an existing table is trusted base. A step that needs a change to `shared/http/` or another listed path becomes two steps, the trusted-base change first, so "one step, one PR" still holds.
- Enforced by: a CI check that a PR touching a trusted-base path touches only trusted-base files, their tests and docs. The root `package-lock.json` may ride along only when the PR changes a dependency field of a trusted package's `package.json` and every other changed path is trusted base or one of its riders (root `package.json` excluded), and every lockfile entry the PR adds, changes or moves sits at an install path in the trusted package's dependency closure (the closure is a set of install paths, not names); a pure move (same name and content at a new path) passes, so hoisting is fine; a version the base already has keeps its resolved, integrity, hasInstallScript, bin and dependency lists at every path; an entry whose name field differs from its path's name fails; dev, optional and peer flag changes pass only inside the base or head closure; anything else fails closed. A version new to the lockfile is taken as npm wrote it; the lockfile is generated, and the dependencies guard, audit, the 7-day rule and SBOM still judge it (ruling 2026-10-05 02:50Z). For migrations, `grant-matrix.json` and `erasure-registry.json` the check parses the diff and fails closed: any role statement or role attribute (`passwordFrom` included), schema grant, `GRANT`/`REVOKE`, default-privilege or policy change on an object the same PR does not create, any `CREATE OR REPLACE` or `ALTER` of a function or view the PR does not create, any changed or removed registry row, any `CREATE TRIGGER`, `CREATE RULE` or `CREATE POLICY` on a table the PR does not create, any `CREATE TABLE` with `AS`, `PARTITION OF`, `LIKE` or `INHERITS`, any new `SECURITY DEFINER` function, any new view over an existing table without `security_invoker = true`, and any statement the parser does not recognise, counts as trusted base. The CODEOWNERS security-review gate in Plan §9 stays and covers all of `infrastructure/postgres/`, new objects included.
- Source: Anderson 3rd ed. — ch. 27–28.
- Status: PARTLY — `02-shared-blocks.md`, Plan §9. NEW: isolated PRs.
- Priority: P1

**SE-7. Log and measure only through a typed field allowlist (event, service, commit, reqId, route template, method, status, ms, code, dep, attempt, counts, migration version, sqlstate). Never log a DID, handle, IP, user agent, email, token, raw URL, record content or user-derived message. Correlate by `reqId` only. This governs logs and metrics; the plan's accountability records (the audit lanes, `pds-admin`'s hash-linked log and the sealed C-16 buffer) are records with their own rules and keep the fields the plan gives them.**
- Enforced by: the logger's type. Biome `noConsole` *(unverified)* or Semgrep outside the logger. A Vitest that sends PII-shaped values through every route group and greps the captured logs.
- Source: SRE — ch. 6, ch. 12; DevOps Handbook — ch. 14 (Create Telemetry to Enable Seeing and Solving Problems).
- Status: PARTLY — Plan §6 logging, P1.04 `request_log_uses_template`. NEW: the enforced schema.
- Amended 2026-10-06 (P1.11e): `version` is a non-negative safe integer (anything else is dropped); `sqlstate` is kept only when it matches `^[0-9A-Z]{5}$`, else written as `[sqlstate]`. Neither can carry a DID, handle, IP or token. A new field needs an architecture ruling and a line here. String fields other than `route` and `reqId` are fixed words by shape, so a handle, DID, email, IP or URL cannot pass (P1.03w, ruling 2026-10-06).
- Priority: P1

## 7. Testing

**TE-1. Test a domain through the functions it exports, so a behaviour-preserving refactor changes no test. Use no module mocking (`vi.mock`, `vi.doMock`, `vi.hoisted`). Double only unmanaged dependencies, and only through a contract our code defines. Fakes live in `*.fake.ts`. Only a composition root may import one, and only when the environment is not production (decision 23 runs the Arachnid fake on the closed-test host); production refuses to start with one wired.**
- Enforced by: a Semgrep ban on module mocking. dependency-cruiser: `*.fake.ts` importable only from tests and `interfaces/*/compose.ts`, with the env check in that file, and vendor SDKs only in their AB-1 adapter folder, tests included. A startup check.
- Source: Khorikov — ch. 2, ch. 5, ch. 8, ch. 11; GOOS — ch. 8 ("Only Mock Types That You Own"); Meszaros — ch. 5, ch. 15; SE@Google — ch. 13.
- Status: PARTLY — EPA §2, ADG §5, Plan Phase 2 (Arachnid refusal).
- Priority: P1

**TE-2. Test against the real things we run. Integration tests use Postgres from the production image, with the real migrations, connected as the per-process role, never superuser. Each file gets its own database cloned from a migrated template. E2e tests run against a production build on the real dev stack, with no request interception.**
- Enforced by: a Semgrep ban on `pg-mem`, PGlite and SQLite. One helper that takes a role name, cloning through a named bootstrap role with `CREATEDB` (not superuser). A Semgrep ban on `page.route(` and `waitForTimeout(` under `tests/e2e/`. Playwright traces kept only on failure, with short retention.
- Source: Khorikov — ch. 8, ch. 10; GOOS — ch. 4, ch. 25; Meszaros — ch. 13, Database Sandbox pattern.
- Status: PARTLY — Plan §7, §8 Phase 1. NEW: the substitute ban (the prototype used SQLite); depends on the dev stack doing real OAuth (F-25).
- Priority: P1

**TE-3. Run one shared contract suite against each fake and its real adapter. Make each fake misbehave on demand (hang, reset, 5xx, 429, malformed or oversized body). Pin our cross-process contracts with JSON golden fixtures (`*.contract.json` in `tests/integration/`). Before relying on a behaviour of `@atproto/*`, `matrix-js-sdk`, Hono or the PDS, read its pinned source and pin the behaviour with a learning test in its adapter folder.**
- Enforced by: a guard that every `*.fake.ts` is passed to a contract suite. Renovate PRs run the integration project. The DL-3 field "why this works (source read)".
- Source: GOOS — ch. 8; Meszaros — ch. 23 (Fake Object); Release It! 2nd ed. — Test Harnesses; Beck TDD — ch. 26 (Learning Test); Pragmatic Programmer — Topic 38.
- Status: PARTLY — CLAUDE.md (read a real client), net-guard tests, `shared/admin-envelope/` (shared code, fixtures as golden vectors).
- Priority: P2, when: the first fake (the PDS writer, Phase 2)

**TE-4. Make the suite provably run:**
- discovered = executed, which also fails on a skipped or todo case, a stray test file, or a zero-test run;
- retries are 0;
- the `unit` project has no network, with time and randomness passed in;
- every `TODO`, `biome-ignore` and `@ts-expect-error` carries a step id or a reason.
- Enforced by: the P0.04 guard, extended. Biome `noFocusedTests` and `noSkippedTests` *(unverified)*. Vitest `retry: 0` and Playwright `retries: 0`. A `unit` setup in which `fetch` throws. A suppression count in the CI summary.
- Source: Meszaros — ch. 16, ch. 17; Khorikov — ch. 4; Pragmatic Programmer — Topic 3; GOOS — ch. 27.
- Status: PARTLY — Plan §2 rule 27, ADG §5, §9, P0.04, EPA §3. NEW: case-level checks and the Playwright half (F-24).
- Priority: P1

**TE-5. Write the test first and prove it can fail. Each slice lists its acceptance tests before any code. Each behaviour or bug fix records its test's pre-fix failure in the PR. Each security control's test is shown going red with the control removed.**
- Enforced by: the PR template field "Red evidence" (DL-3) and each step's "Done when" list.
- Source: Beck TDD — ch. 25 (Test List, Test First); GOOS — ch. 1, ch. 5 (double loop); Meszaros — ch. 17; WELC — ch. 13.
- Status: NEW (ADG §11 never requires the red step).
- Priority: P1. A red-first CI job comes in P2, when bug-fix PRs exist.

**TE-6. Give every parser, validator, serialiser and encoder on a trust boundary a fast-check property test, with fixed `numRuns` and the seed printed on failure. Keep every shrunk counterexample as a plain example test.**
- Enforced by: review against the target list (return-path validator, island serialiser, handle normalisation, cursor codec, net-guard classifier, brand parsers).
- Source: Pragmatic Programmer — Topic 42; Practice of Programming — ch. 6; Beck TDD — ch. 26.
- Status: PARTLY — Plan §2 rule 5, §5.1, P1.09 (fast-check already planned).
- Priority: P1

**TE-7. Write tests DAMP:**
- name each test for its behaviour, in product words;
- one act per test, with no logic;
- build data with builders that use reserved fake identities (`.test` or the dev PDS's suffix, `example.com`, generated DIDs);
- no coverage gate;
- no snapshot test except the security-header snapshot (CSP, HSTS, nosniff, Referrer-Policy, Vary; P1.26), which exists so any header change is deliberate.
- Enforced by: review. A guard against real-looking handles and emails in tests. A Semgrep ban on `toMatchSnapshot` outside the security-header test (P1.26).
- Source: SE@Google — ch. 12 ("DAMP, Not DRY"); Khorikov — ch. 1, ch. 3; Meszaros — ch. 15, ch. 16; GOOS — ch. 22.
- Status: PARTLY — EPA §2, §4, Plan §2 rule 15.
- Priority: P1

## 8. APIs and contracts

**AP-1. Evolve `sh.unset.*` lexicons only as the atproto spec allows: optional additions, `knownValues` over `enum`, open unions with a neutral fallback, and a new NSID for any breaking change. Declare every XRPC error there and branch on its name, never its message. Send `Retry-After` with every 429.**
- Enforced by: the `lex` diff in CI (adding a value to a closed enum counts as breaking). A Vitest that each method's error names exist in its lexicon. A Semgrep ban on `.message.includes(`.
- Source: atproto Lexicon spec, https://atproto.com/specs/lexicon; atproto XRPC spec, https://atproto.com/specs/xrpc; API Design Patterns — ch. 24; SE@Google — ch. 1 (Hyrum's Law).
- Status: PARTLY — Plan §6.1 (lexicon versioning, SemVer read API), phase-3 error names.
- Priority: P1

**AP-2. Give every list endpoint one pagination contract:**
- `limit` with a default and a maximum;
- an opaque keyset cursor with a unique tiebreaker (no `OFFSET`, no totals);
- the cursor parsed as untrusted (malformed → `InvalidCursor`);
- visibility re-applied on every page.
- Enforced by: one cursor codec in `shared/`. A contract test feeding garbage cursors to every list route.
- Source: API Design Patterns — ch. 21; atproto XRPC spec, https://atproto.com/specs/xrpc.
- Status: PARTLY — phase 3 `getAuthorFeed`, P3.03.
- Priority: P2, when: the first list route (Phase 3)

## 9. Delivery, review and git

**DL-1. Keep each PR to one step and one ownership path, under about 400 changed source lines (generated code, lockfile and lexicon JSON excluded), alive under 2 days. Put refactoring and behaviour change in separate commits. A PR that loosens an existing assertion needs a "Behaviour change" section that Alex approves.**
- Enforced by: a size guard on `git diff --numstat` (warn at 400; failing per **D3**). A CI step that finds removed `expect(` lines and requires the section.
- Source: Accelerate — ch. 4; DevOps Handbook — ch. 18; Refactoring 2nd ed. — ch. 2 (two hats); Beck TDD — ch. 27 (Clean Check-in).
- Status: PARTLY — README rule 11, ADG §10, EW §1–2, EPA §3.
- Priority: P1

**DL-2. Give each agent session one slice with one owning domain. Land a `shared/` or `infrastructure/` change as its own PR first. Keep at most three agent PRs waiting for Alex (D4). Keep `[SPIKE]` work on `spike/<name>`, never merged, with its result recorded in an ADR.**
- Enforced by: review-only. A CLAUDE.md instruction plus `gh pr list --state open` before starting; no tool can see concurrent sessions.
- Source: Team Topologies — ch. 2, ch. 3; Mythical Man-Month — ch. 2, ch. 11.
- Status: PARTLY — CLAUDE.md worktree rules, ADG §4.
- Priority: P1 (spikes P2)

**DL-3. Open every PR with the one fixed template (`.github/pull_request_template.md`, step P0.09), the only list of PR fields. Its headings are Step, What, Why, How to test and Security review; the fields below sit under them and are filled or marked n/a:**
- step id and why;
- ownership path;
- Threats link;
- ASVS rows;
- tests with red evidence;
- behaviour change;
- performance evidence;
- migration or rollback;
- why this works (source read);
- needs an ADR?;
- branch age;
- what I am unsure about.

**The agent self-reviews against the template before asking Alex.**
- Enforced by: `.github/pull_request_template.md`. A CI check that the headings are present. One exception: a PR whose author login is `renovate[bot]` and whose author type is `Bot` skips the heading check only; every other pr-shape check still runs, and Renovate's own `labels` config sets its kind label (ruling 2026-10-05 12:00Z).
- Source: SE@Google — ch. 8–9; Code Complete 2nd ed. — ch. 21; Pragmatic Programmer — Topic 38.
- Status: NEW (no PR template exists yet).
- Priority: P1

**DL-4. Keep `main` releasable: every change to a running host goes through PR, CI and the deploy command, and break-glass use is recorded by a PR afterwards. A red `main` or a bad deploy is reverted first. From P5.00 the production host can be rebuilt from the repository plus the secret store.**
- Enforced by: branch protection. GitHub's own failure notification for a red `main`. P5.03 preflight refuses a non-green or dirty commit. A weekly drift check run from Alex's machine. Nothing in CI holds production credentials or writes to production.
- Source: Continuous Delivery — ch. 3, ch. 10; DevOps Handbook — ch. 11; Infrastructure as Code 2nd ed. — ch. 2, ch. 7.
- Status: PARTLY — P0.03, P5.03, P5.05, Plan §2 rule 24, §8, admin design §11.
- Priority: P1 (rebuild and drift parts P2, when: P5.00)

**DL-5. Deploy the closed-test host the way production deploys (signed images by digest, the same preflight, `deploy <commit>`, single replica), with a smoke check beyond `/health` that rolls back on failure. Separate deploy from release only through named, typed switches with a fail-safe default; add no general feature-flag system.**
- Enforced by: `smoke_failure_rolls_back`. Typed config validation.
- Source: Continuous Delivery — ch. 5; Release It! 2nd ed. — Design for Deployment; DevOps Handbook — ch. 12; SRW — ch. 14.
- Status: PARTLY — Plan §2 rule 23, P1.27, P1.30, P2.26a (minimal digest deploy, D5), P5.03, P5.08d.
- Priority: P2, when: the test track starts (end of Phase 2, if D5 = a)

**DL-6. Write the commit subject as the step id plus a capitalised, imperative summary with no trailing period, completing "If applied, this commit will …" (`P1.07 Enforce exact Origin match in CSRF gate`). Separate the body with a blank line, wrap it at 72 and say what and why. Use no Conventional Commits prefix (D2).**
- Enforced by: one pure `checkCommitMessage()` in `scripts/guards/commit-msg.ts`. It runs in an opt-in `scripts/githooks/commit-msg` and in CI on the PR title (read from env, never interpolated into `run:`) and on each commit.
- Source: Beams, How to Write a Git Commit Message, https://cbea.ms/git-commit/ (rules 1–7). Our adaptation: Beams counts 50 characters over the whole subject, and we count them after the step id. 72 stays the hard limit for the whole line.
- Status: NEW (EW §2 asks for clear messages; README rule 11 puts the step id first).
- Priority: P1

## 10. Documentation and decisions

**DO-1. Write an ADR in `docs/human/decisions/` for every decision that is expensive to reverse. That covers:**
- a data model or migration shape;
- an external or lexicon contract;
- a process, role or network boundary;
- a runtime dependency or service;
- a new pattern or top-level folder;
- a cross-domain dependency;
- a security mechanism.

**Each ADR has Context, Decision, Alternatives (at least two), Consequences and Compliance. A dev dependency needs only the EPA §5 note in its PR.**
- Enforced by: the docs test (front matter, status values, the index lists every file). The DL-3 field "needs an ADR?".
- Source: FoSA 1st ed. — ch. 19 (2nd ed. ch. 21); Documenting SA 2nd ed. — Prologue (rule 5, record rationale); APoSD 2nd ed. — ch. 11 (design it twice); Hard Parts — ch. 1.
- Status: PARTLY — ADRs 0001 (append-only log, D8), 0002 (engineering rules), 0003 (bootstrap reconciliation), the no-orchestrator ADR (F-23), P0.09, AI §15–16, EW §7, EPA §5.
- Priority: P1

**DO-2. Record a decision Alex makes in a thread or on a card in an ADR, in the first PR that depends on it. Change an accepted ADR only to mark it superseded, under the transition D8 sets for ADR 0001. An agent whose change would contradict an accepted ADR stops and asks.**
- Enforced by: the docs test (the body of an Accepted ADR is unchanged, apart from what D8 allows). Review.
- Source: FoSA 1st ed. — ch. 19 (Groundhog Day, Email-Driven Architecture; 2nd ed. ch. 21).
- Status: PARTLY — AI §16, ADR 0001, decisions 1–34 in the plan.
- Priority: P1 (D8 adopted)

**DO-3. Work from current official documentation, never from memory alone. Before relying on how a library, API, tool, protocol or service behaves, read its official documentation, or its source, for the exact version we pin, and cite what you read (URL or file path, plus the version) in the code comment, commit, PR or reply. When the documentation and memory disagree, the documentation wins. When it is silent or unreachable, say so and treat the behaviour as unverified until a test proves it.**
- Enforced by: review-only. A reviewer asks "where is this documented?" for any behaviour a change depends on; a claim with no citation is treated as unverified. CLAUDE.md states the rule.
- Source: Pragmatic Programmer 2nd ed. — Topic 38 (Programming by Coincidence: rely only on reliable things, document your assumptions); Alex, 2026-10-04 23:59Z ("a real professional always refers to the most updated current documentation").
- Status: NEW (Alex, 2026-10-05). The CLAUDE.md rule "read a real client" for Matrix work is one case of it.
- Priority: P1

## 11. Performance

**PF-1. Count round trips on request paths. No query inside a loop (batch with `= ANY($1)`). Assert each route's query count against the ≤5 budget. Each new index names the query it serves. Back each performance-justified cache, index or denormalisation with before-and-after p50/p95/p99, never a mean alone.**
- Enforced by: a query-counter helper in integration tests. A Semgrep heuristic for an awaited DB call inside `for`/`.map`. A hot-path `EXPLAIN` test run with `enable_seqscan = off`, asserting the named index is used. The DL-3 performance field.
- Source: Systems Performance 2nd ed. — ch. 2, ch. 12; CS:APP 3rd ed. — §1.9.1 (Amdahl's Law); Programming Pearls 2nd ed. — Columns 6–7; SQL Antipatterns — Index Shotgun.
- Status: PARTLY — EW §6, Plan §6.1 (≤5 queries, ≤50 ms).
- Priority: P1 (EXPLAIN tests P2, when: Phase 3 feeds)

**PF-2. Never block the event loop:**
- no `*Sync` fs, crypto, zlib or child_process calls outside boot code;
- no `JSON.parse` or regex on user input before a size cap;
- no nested-quantifier regex on user input;
- CPU-heavy work runs in a worker thread or the `review` process.
- Enforced by: a Semgrep rule on `\w+Sync\(` under `interfaces/`, `domains/`, `infrastructure/` (Biome has no such rule). A Semgrep ReDoS rule.
- Source: OSTEP — ch. 33 (Event-based Concurrency); CS:APP 3rd ed. — ch. 12.
- Status: NEW (Plan §2 rule 10 covers image decode only).
- Priority: P1

---

## Decisions (all resolved 2026-10-04 12:56Z: the recommended option was adopted for each)

**D1. Function size.** Keep README rule 3's "about 40 lines", or change it?
- Options: (a) keep it; (b) "a function does one job at one level of abstraction and usually fits on a screen; do not split it to meet a line count", with cognitive complexity as the warning (DC-1); (c) drop size guidance.
- Recommendation: (b).
- Reason: security code is audited as an ordered sequence of checks that tiny helpers would hide, and AI authors over-decompose. Code Complete §7.4 finds no evidence for small caps.

**D2. Commit convention.**
- Options: (a) Beams plus a step-id prefix, with the kind of change carried by a PR label; (b) Conventional Commits; (c) both.
- Recommendation: (a), with squash title = PR title and squash message = commit messages.
- Reason: under squash merging the title becomes the subject on `main`. A scoped prefix such as `fix(csrf): ` takes 11 characters (our count, not Beams'), and its lowercase breaks Beams' capitalisation rule. Nothing consumes the types, and labels serve the red-first job.

**D3. PR size.**
- Options: (a) warn above about 400 lines, never fail; (b) warn at 400 and fail above 800 unless the PR has a `large-pr` label and a reason; (c) no signal.
- Recommendation: (b), with tests excluded from the count.
- Reason: a label overrides it cheaply, but it stops a 2,000-line PR turning review into a rubber stamp. Excluding tests keeps agents from trimming tests to fit.

**D4. Review queue.**
- Options: (a) at most three agent PRs waiting, sev-1/2 fixes excepted; (b) no cap; (c) a cap of one.
- Recommendation: (a).
- Reason: review cost lands on one person (Mythical Man-Month ch. 2). Three keeps work flowing without a backlog that forces rebases. It is a CLAUDE.md instruction, not a tool.

**D5. Move a minimal digest-verified deploy to the end of Phase 2?**
- Options: (a) yes: a minimal P5.03 (verify, pull by digest, preflight, migrate, smoke check, rollback) when the closed test starts; (b) keep it at P5.03.
- Recommendation: (a). It sits after the first slice, so it adds nothing to that slice.
- Reason: otherwise the test host deploys differently for about a year (Continuous Delivery ch. 5). It changes the step book (F-11).

**D6. Stryker mutation testing.**
- Options: (a) defer, and reconsider for the Phase 5 security tests; (b) adopt now for the security-guard modules, run at phase exits.
- Recommendation: (a).
- Reason: it is a large dev-dependency tree, its TS 7 support is unverified, and it is slow. TE-5's "red with the control removed" gives most of the value now.

**D7. Private profile versus missing.** Should a private profile look the same as a missing one?
- Options: (a) keep the plan: a distinct `ProfilePrivate` error and a "private" page (Plan §5.4; then P3.10 and P3.12 in phase-3.md); (b) fold private into `AccountUnavailable`, so outsiders cannot tell "exists but private" from "absent".
- Recommendation: (b), if the product does not need to tell visitors the profile exists.
- Reason: (b) leaks less, since existence itself is information (API3, Anderson ch. 11). Adopted (b) 2026-10-04; plan §5.4 and phase-3 `ProfilePrivate` change to match.

**D8. ADR immutability against current practice.** Decisions 28–33 were recorded by editing ADR 0001.
- Options: (a) ADR 0001 becomes an append-only decisions log, and each new decision gets its own ADR; (b) keep editing ADR 0001 freely; (c) split 0001 now.
- Recommendation: (a).
- Reason: it keeps history intact, costs nothing today, and lets DO-2's docs test exempt appends to 0001 only.

**D9. Service health metrics and decision 17.**
- Options: (a) allow per-service `ops.metric` health signals (never per user, retention listed in the retention table and the RoPA) alongside `metrics_daily`; (b) `metrics_daily` only, with no RE-4.
- Recommendation: (a).
- Reason: EPA §6 asks for operational signals. Decision 17 is about product measurement, but its wording ("only measurement") is absolute, so it needs your word.

---

## Sources

Chapter numbers match the edition named. URLs are the tables of contents review B checked on 2026-10-04.

- **APoSD**: John Ousterhout, *A Philosophy of Software Design*, 2nd ed. (ch. 1–20 are numbered as in the 1st ed.). https://web.stanford.edu/~ouster/cgi-bin/book.php
- **Code Complete**: Steve McConnell, *Code Complete*, 2nd ed. https://ptgmedia.pearsoncmg.com/images/9780735619678/samplepages/9780735619678.pdf
- **Clean Code**: Robert C. Martin, *Clean Code* (2008). https://catdir.loc.gov/catdir/toc/ecip0820/2008024750.html
- **Clean Architecture**: Robert C. Martin, *Clean Architecture* (2017). https://www.oreilly.com/library/view/clean-architecture-a/9780134494272/ch23.xhtml
- **SE@Google**: Titus Winters, Tom Manshreck, Hyrum Wright, *Software Engineering at Google* (2020). https://www.oreilly.com/library/view/software-engineering-at/9781492082781/ch11.html ; https://abseil.io/resources/swe-book
- **Effective Java**: Joshua Bloch, *Effective Java*, 3rd ed. https://www.oreilly.com/library/view/effective-java-3rd/9780134686097/contents.xhtml
- **Pragmatic Programmer**: David Thomas, Andrew Hunt, *The Pragmatic Programmer*, 20th anniversary ed. https://www.pearson.de/media/muster/toc/toc_9780135957035.pdf
- **Practice of Programming**: Brian Kernighan, Rob Pike, *The Practice of Programming*. https://www.cs.princeton.edu/~bwk/tpop.webpage/toc.html
- **Programming Pearls**: Jon Bentley, 2nd ed. https://www.oreilly.com/library/view/programming-pearls-2nd/9780134498058/toc.html
- **Refactoring**: Martin Fowler, 2nd ed. https://www.martinfowler.com/articles/refactoring-2nd-changes.html
- **WELC**: Michael Feathers, *Working Effectively with Legacy Code*. https://www.oreilly.com/library/view/working-effectively-with/0131177052/ch13.html
- **GoF**: Gamma, Helm, Johnson, Vlissides, *Design Patterns* (1994). Not checked online.
- **FoSA**: Mark Richards, Neal Ford, *Fundamentals of Software Architecture*, 1st ed. (2020) and 2nd ed. (2025). ADRs are ch. 19 in the 1st ed. and ch. 21 in the 2nd. https://www.oreilly.com/library/view/fundamentals-of-software/9781492043447/ch19.html ; https://www.oreilly.com/library/view/fundamentals-of-software/9781098175504/app01.html
- **Hard Parts**: Ford, Richards, Sadalage, Dehghani, *Software Architecture: The Hard Parts* (2021). https://www.oreilly.com/library/view/software-architecture-the/9781492086888/app02.html
- **Cosmic Python**: Harry Percival, Bob Gregory, *Architecture Patterns with Python* (2020). https://www.cosmicpython.com/book/preface
- **Evans DDD**: Eric Evans, *Domain-Driven Design* (2003). https://www.oreilly.com/library/view/-/0321125215
- **IDDD**: Vaughn Vernon, *Implementing Domain-Driven Design* (2013). https://www.oreilly.com/library/view/implementing-domain-driven-design/9780133039900/ch06.html
- **DDD Distilled**: Vaughn Vernon (2016). https://www.oreilly.com/library/view/domain-driven-design-distilled/9780134434964/toc.html
- **Fairbanks**: George Fairbanks, *Just Enough Software Architecture* (2010). https://www.georgefairbanks.com/assets/jesa/Frontmatter.pdf
- **Documenting SA**: Clements et al., *Documenting Software Architectures*, 2nd ed. (2010). https://ptgmedia.pearsoncmg.com/images/9780321552686/samplepages/0321552687.pdf
- **DDIA**: Martin Kleppmann, *Designing Data-Intensive Applications*, 1st ed. (chapter numbers differ in the 2nd ed.). https://api.pageplace.de/preview/DT0400.9781491903117_A29629813/preview-9781491903117_A29629813.pdf
- **Database Internals**: Alex Petrov (2019). https://www.oreilly.com/library/view/database-internals/9781492040330/ch04.html
- **SQL Antipatterns**: Bill Karwin, Vol. 1 (2022). https://pragprog.com/titles/bksap1/sql-antipatterns-volume-1/
- **Understanding Distributed Systems**: Roberto Vitillo, 2nd ed. (2022). https://understandingdistributed.systems/sample.pdf
- **Burns**: Brendan Burns, *Designing Distributed Systems*, cited by pattern name (Ownership Election is ch. 9 in the 1st ed. and ch. 10 in the 2nd). https://www.oreilly.com/library/view/designing-distributed-systems/9781098156343/ch10.html
- **Release It!**: Michael Nygard, 2nd ed. (2018). https://pragprog.com/titles/mnee2/release-it-second-edition/
- **SRE / SRW**: Beyer et al., *Site Reliability Engineering* (2016) and *The Site Reliability Workbook* (2018). https://sre.google/sre-book/table-of-contents/ ; https://sre.google/workbook/table-of-contents/
- **Continuous Delivery**: Jez Humble, David Farley (2010). https://www.pearson.de/media/muster/toc/toc_9780321670274.pdf
- **DevOps Handbook**: Gene Kim, Jez Humble, Patrick Debois, John Willis (chapter numbers as in the TOC review B checked). https://gist.github.com/stldevops/82c0268d88c411697e48602fb55c45ef
- **Accelerate**: Nicole Forsgren, Jez Humble, Gene Kim (2018). https://www.oreilly.com/library/view/accelerate/9781457191435/13-ch2.xhtml
- **Infrastructure as Code**: Kief Morris, 2nd ed. (2020). https://www.oreilly.com/library/view/infrastructure-as-code/9781098114664/part02.html
- **Beck TDD**: Kent Beck, *Test-Driven Development: By Example* (2002). https://www.oreilly.com/library/view/test-driven-development/0321146530/
- **GOOS**: Steve Freeman, Nat Pryce, *Growing Object-Oriented Software, Guided by Tests* (2009). https://growing-object-oriented-software.com/toc.html
- **Khorikov**: Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (2020). https://www.oreilly.com/library/view/unit-testing-principles/9781617296277/Text/kindle_split_003.html
- **Meszaros**: Gerard Meszaros, *xUnit Test Patterns* (2007). https://www.pearson.de/media/muster/toc/toc_9780321504807.pdf
- **Shostack**: Adam Shostack, *Threat Modeling: Designing for Security* (2014). https://www.oreilly.com/library/view/threat-modeling-designing/9781118810057/9781118810057p03.xhtml
- **Anderson**: Ross Anderson, *Security Engineering*, 3rd ed. (2020). https://www.oreilly.com/library/view/security-engineering-3rd/9781119642787
- **The Tangled Web**: Michal Zalewski (2011). https://nostarch.com/tangledweb
- **OWASP**: Top 10:2025, https://top10.owasp.org/2025/ ; ASVS 5.0, https://cornucopia.owasp.org/taxonomy/asvs-5.0 ; API Security Top 10:2023, https://www.isaca.org/resources/news-and-trends/industry-news/2023/reviewing-the-2023-owasp-api-top-10 (items API1, 3, 5, 9 and 10 match the official list)
- **API Design Patterns**: JJ Geewax (2021). https://www.sharelearn.net/learn/courses/orl-9781617295850ve/
- **Building Microservices**: Sam Newman, 2nd ed. (2021). https://www.oreilly.com/library/view/building-microservices-2nd/9781492034018/ix01.html
- **Production Kubernetes**: Josh Rosso et al. (2021). https://www.oreilly.com/library/view/production-kubernetes/9781492092292/ch01.html
- **Systems Performance**: Brendan Gregg, 2nd ed. (2020). https://www.brendangregg.com/systems-performance-2nd-edition-book.html
- **CS:APP**: Randal Bryant, David O'Hallaron, *Computer Systems: A Programmer's Perspective*, 3rd ed. https://csapp.cs.cmu.edu/3e/pieces/preface3e.pdf
- **OSTEP**: Remzi and Andrea Arpaci-Dusseau, *Operating Systems: Three Easy Pieces*. https://pages.cs.wisc.edu/~remzi/OSTEP/threads-bugs.pdf ; https://pages.cs.wisc.edu/~remzi/OSTEP/threads-events.pdf
- **Team Topologies**: Matthew Skelton, Manuel Pais (2019). The team API is introduced in ch. 3. https://itrevolution.com/articles/visualize-team-dependencies-with-a-team-api/
- **Mythical Man-Month**: Fred Brooks, anniversary ed. (1995). https://ptgmedia.pearsoncmg.com/images/9780201835953/samplepages/0201835959.pdf
- **atproto specs**: Lexicon, https://atproto.com/specs/lexicon ; XRPC, https://atproto.com/specs/xrpc
- **Beams**: Chris Beams, How to Write a Git Commit Message. https://cbea.ms/git-commit/
