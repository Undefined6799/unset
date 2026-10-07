# unset.sh step book

Status: **draft, under multi-agent review.** Planning only: no code exists and none is written here.
Source of truth: [`../unset-sh-rebuild-plan.md`](../unset-sh-rebuild-plan.md) (its current revision, with decisions 1–23
folded in) and its ADR. Where this book and the plan disagree, the plan wins and the book is wrong;
report it, never "fix" it locally. The fifth governing document is the *Engineering Rules*
(`../engineering/engineering-rules.md`, adopted by Alex as decision 35, 2026-10-04 12:56Z; in the repository
`docs/human/engineering/engineering-rules.md`, ADR 0002): a rule never overrides the plan, and the architecture guideline
wins over a rule on structure.

## What this is for

Alex's goal (2026-10-02): once this book is reviewed, coding agents build the whole app from it **without
being directed**, stopping only at points the book marks in advance. So every step is written so an agent can
build it without guessing:

- small enough to be **one pull request** (typically 50–400 source lines plus tests);
- in **build order**, with explicit dependencies;
- as an **algorithm**: what it takes in, what it produces, the ordered steps in pseudocode, the edge cases and
  how each fails, and the exact tests that prove it is done;
- with its **stop points** marked, so an agent knows where it must not decide alone.

## Files

| File | Contents |
|---|---|
| `00-README.md` | this file: conventions, the step template, tags, global invariants |
| `01-outline.md` | every step id in build order with its dependencies, plus the dependency diagrams |
| `02-shared-blocks.md` | only the invariant-2 security mechanisms that must exist exactly once, each with its owner step, signature and "never" rules (reuse rule 9) |
| `03-glossary.md` | the domain words (DID, PDS, rkey, applyWrites, …) in one sentence each, so a reader of the code never has to guess |
| `phase-0.md` … `phase-6.md` | the steps, one file per phase. `phase-1.md` and `phase-4.md` were each merged from two parts (2026-10-03); `phase-1-part*.md` and `phase-4-part*.md` are one-line pointers to them |
| `launch-gate.md` | the steps between "Phase 6 done" and the invite-only launch |
| `editor-todo.md` | the lead's working list of cross-file items for the editor pass |
| `layout-map.md` | every old path (`packages/`, `apps/`, `modules/`, `deploy/`, …) mapped to the decision-34 layout, with the open points |
| `plan-issues.md` | gaps or contradictions found in the plan while breaking it down (routed to the plan thread) |
| `reviews/` | reviewer reports, one per round per phase, and the answers to them |

## Depth of detail (Alex, 2026-10-03: "detail by risk")

Following Alex's architecture principles 13–15 (progressive refinement; reversibility decides design depth):
- **Phases 0, 1 and 2 are build-ready**: full algorithms, tests and stop points, reviewed in two rounds.
- **Phases 3 to 6 and the launch gate** keep in full only what is expensive to reverse: data model and
  migrations, security and trust boundaries, roles and grants, external contracts (lexicons, scopes, protocol
  keys, Matrix room settings fixed at creation), legal and privacy flows, stop points and the "done when" tests.
  Their algorithm sections are a **reviewed hypothesis**: the first step of each phase (`P<n>.00 Refine`) re-reads
  that phase against what was actually built, updates it, and has it reviewed before any other step of the phase.
  Each refine step also records the **feature ownership path** of every feature of its phase (decision 34, guideline
  §4) and settles the `layout-map.md` open points the phase touches. **Every `P<n>.00` step (and L.00) also does an AI
  notes tidy pass** (plan §7, Alex 2026-10-04 22:11Z; P0.09d's guard lists the warnings): re-check the notes the
  warnings list, merge duplicates, mark replaced notes, delete finished handoffs, and port the old 0x40 notes the
  phase needs (re-checked against the current spec and code, fresh `checked` date). One commit, reviewed like code.
- **Slices (decision 34, guideline §12).** The build starts with one thin end-to-end slice, "sign in with an atproto
  account and see your own profile" (`01-outline.md`, "Slice 1"), ends it with a review step (P2.13a), and only then
  adds the next slice. Step ids did not change; the order and some dependencies did.
- **English first (Alex, 2026-10-04 12:58Z, against the recommendation).** Slice 1 is English only. Its screens keep
  their user-facing English text in **one messages module per feature** (`messages.ts`: plain exported constants, or a
  small function of its parameters returning a string; no catalog machinery). Translations are their own later slice,
  the **i18n slice** (P1.19, P1.22b; `01-outline.md`), still inside Phase 1 and before its exit P1.38; its first task
  converts those modules into the EN/FR catalogs. No French page ships before the i18n slice lands.
- When building shows a boundary is wrong, the agent follows principle 16: fix locally, refactor on repetition,
  and stop for human review before changing a core boundary, public contract or data model.

## Step ids

`P<phase>.<nn>`, for example `P1.07`. Ids are fixed once `01-outline.md` is reviewed; a step added later
takes a letter suffix (`P1.07a`) so references never shift. Exactly one suffix letter: the commit-msg guard
(`scripts/guards/commit-msg.ts:17`) accepts `P[0-6].nn` or `L.nn` plus at most one letter (D2). A split of a lettered step takes a fresh single letter on the base number, one not
yet used for it, never two letters (P1.11t's config split is P1.11v, first recorded as P1.11tq).

## Tags

| Tag | Meaning for the building agent |
|---|---|
| `[ALEX]` | Alex does this by hand (a purchase, a key ceremony, a GitHub admin setting). The agent prepares the runbook or checklist, then **stops** until Alex reports it done. |
| `[STOP]` | A product, legal or security choice the plan does not settle. The agent builds nothing past this point; it writes the question with options and a recommendation and asks. |
| `[SPIKE]` | An experiment against outside software. Its result is written to an ADR. If the result contradicts the steps after it, the agent **stops** and the book is revised before continuing. |
| `[SEC]` | Touches auth, identity, crypto, egress, PII or access control. Needs the security review the plan requires (CODEOWNERS path rule) before merge. |
| `[CHAT]` / `[MOD]` | Depends on the chat or moderation design, which may still shift if Alex takes the optional second review pass on those areas. |
| `[PERMANENT]` | Fixes something users depend on that cannot change after it ships without breaking them (an NSID, a lexicon field, a hostname, a protocol key). Alex approves the value in the step; a later change is a new name, never an edit. |

Every pull request, tagged or not, needs Alex's approval to merge (plan §8, Phase 0). Agents open PRs; they never approve or merge.

## Alex question labels

A question for Alex carries a label namespaced by the file (or part) that asks it, so labels never collide across
files: `P0-A1` (phase 0), `P1a-A1` (P1.01–P1.19) and `P1b-A1` (P1.20–P1.38), `P2-A1`, `P3-A1` and `P3-B1` (phase 3's
two series), `P4a-A1` (P4.01–P4.15) and `P4b-E3` (P4.16–P4.28, which keeps its review finding numbers), `P5-A1`,
`L-A1` (launch gate), `P6-A1`. One question asked from two files is one card with both labels (for example `P5-A5` is
`L-A1`).

## The step template

Every step in `phase-*.md` uses exactly these headings. "None" is a valid answer; a missing heading is a defect. The
`Feature:` line is new (decision 34, 2026-10-04): steps written before it carry it from their phase's refine step
(Phases 3 to 6) or from P2.13a and the next slice reviews (Phases 1 and 2); it is not back-filled into old steps by hand.

```text
### P1.07 — <short name>
Tags: [SEC] …            Depends on: P1.04, P1.05            Plan: §2 rule 14, §5.1
Where: <top-level folder / workspace (decision-34 layout)>, <files it creates or changes>
Feature: <feature name>: <ownership path, e.g. apps/web → interfaces/http → domains/identity → infrastructure/pds → PDS>
  (from the phase's refine step; a step that lands a feature's first slice also writes docs/human/features/<feature>.md)
Size: ~<n> source lines, ~<n> test lines

Goal: one sentence, in plain words.

Inputs: what exists before this step (prior steps' outputs, config keys, tables, env).
Outputs: what exists after it: modules and their interface shapes (names, parameters, return
  values, errors, written as typed pseudocode, not code), tables and columns, routes, config keys.

Algorithm:
  1. Ordered steps in pseudocode. Every branch says what happens.
  2. …

Edge cases and failures:
  - <case> → <exact behaviour> (fail closed unless the plan says otherwise).

Threats: ([SEC] steps only) the trust boundary this step guards, in one line; then one line per threat:
  - <STRIDE letter: S spoofing, T tampering, R repudiation, I disclosure, D denial of service, E elevation>
    <threat> → <the control, in this step or the step that owns it> (<test id from "Done when", or "accepted: <who,
    where>">). New personal data also names its purpose and where it is erased.

Done when (tests):
  - <test name>: <what it sets up> → <what it asserts>.
  - Each test is runnable on its own; together they cover every edge case above.
  - AI notes updated or none needed (every step, written or not; the PR template's `AI notes:` line and P0.09d's
    guard check it; plan §7).

Reuse: <candidate> → <verdict>. Filled by the reuse reviewer; see "Salvage rule" below.
Not in this step: things a builder might be tempted to add, with the step that owns them.
Diagram: (only for multi-party flows, state machines or trust boundaries) a Mermaid block.
```

The `Threats:` heading (editor pass 2026-10-04, findings F-26) is required for `[SEC]` steps. Phases 0–2 have it on
every `[SEC]` step; Phases 3–6 and the launch gate have it only on `[SEC]` steps whose algorithm is already full detail,
and each phase's refine step (`P<n>.00`) writes it for the rest when it settles their algorithms. It lists threats; the
controls and tests stay in the step's own sections, so a threat line never adds behaviour the step does not specify.

Pseudocode style: numbered imperative lines, named inputs and outputs, `if … then … else …` spelled out,
loops bounded, every external call followed by what happens on timeout, error and success. No language-specific code.

## Salvage rule (Alex, 2026-10-02)

"Start fresh; we may be able to salvage, but the idea is to make better code."

- The old 0x40 prototype (`github.com/Undefined6799/0x40` at `054ab0f`) and open-source libraries are **candidates only**.
- A candidate is marked **SALVAGE** only when a reviewer has read it and confirmed it already meets this step's
  algorithm, the plan's rules (§2) and this step's tests. The step then says what must change (renames, removed
  coupling, added tests) and cites `path:line`.
- Otherwise it is **LESSON** (read it for what it got right or wrong, write fresh) or **REJECT** (do not copy;
  the reason is given, usually one of the prototype defects in plan §2).
- A library is **USE** when the plan names it or the reviewer confirms licence, maintenance, exact pin and that it
  fits the step's security rules.

## Global invariants (every step keeps these)

These come from plan §2, §6 and §6.1. A step that would break one is wrong even if its own tests pass.

1. Fail closed. An exception inside an auth, CSRF or authz path denies (OWASP Top 10 2025 A10).
2. One way to do each thing: one config loader, CSRF gate, CSP builder, egress (`net-guard`), lexicon validator,
   props serialiser, `createRoom`, `profileHref`, `verifyHandle`. A step never adds a second one. `profileHref` (the
   link to a member's profile, built only from the verified handle or the DID) is owned by **P3.12**
   (`canonicalActorPath` is its internal helper); `safeHref`/`SafeHref` for every other link is owned by **P1.24**.
3. No IP addresses or user agents written anywhere (logs, tables, metrics). There are two exceptions, and the P0.06
   `ip-columns` check allow-lists exactly these places:
   - the per-upload transmission buffer, sealed to the legal-hold public key and destroyed within minutes unless a
     fingerprint matches (plan §5.8, decision 21);
   - **staff** tailnet addresses (100.64.0.0/10, fd7a:115c:a1e0::/48) of people signing in to `admin`, in exactly the
     places P3.17 lists: `adm.session.login_ip` and `pds-admin`'s revoke file (`adm.known_device` stores only an
     HMAC of the address). The audit holds no PII side rows (P1a-A1 answered "No address", 2026-10-07; book edit
     2026-10-06-p115m-tailnet-deferral-steps, architecture 00:20Z). Never a member's address, never user agents
     (phase-3 plan issue PI-2).
4. No secret is optional, none is printed, none is in code, logs or responses.
5. Every SQL statement is parameterised; every table with a DID column is reached by `eraseDid`.
6. Nothing private reaches a repo. Only Publish writes to a repo, and only after review where the plan requires it.
7. No raw `getBlob` URL reaches a browser; all media goes through the media proxy.
8. Every user-visible string is in the EN and FR catalogs; every page passes axe-core in both themes. Exception
   (English first, Alex 2026-10-04): until the i18n slice lands, slice-1 strings live in their feature's `messages.ts`
   and pages are tested in English only; P1.19's first task moves them into the catalogs.
9. Tokens only in CSS; no new UI component unless it is on the design sheet with Alex's approval.
10. Every new dependency is pinned exactly and justified in its PR.
11. Tests are Vitest; the "discovered equals executed" guard stays green. Unit tests sit next to the file they test
    (`*.test.ts`); integration tests go in `tests/integration/`, end-to-end tests (Playwright) in `tests/e2e/`
    (decision 34, guideline §5).
12. Matrix work follows the repository's chat rule: read Element/cinny and the spec first, cite them (DO-3).
13. The decision-34 layout and its boundary rules hold (plan §7, guideline §1, P0.05): `domains/` never import
    `infrastructure/`, `interfaces/` or `apps/`; `apps/` import only `shared/`, and only the interface serving an app
    imports its render entry; interfaces never import each other; `pds-admin` and `chat-admin` import only their own
    folder, Node built-ins and the zero-dependency allowlist (today `shared/admin-envelope/`); each vendor SDK is
    imported in exactly one adapter folder per runtime. Every running process has its own `interfaces/<name>/`.
    `scripts/` is repository tooling that product code never imports. Folders are created when their first code lands;
    no `packages/`, `modules/` or `plugins/`.
14. Data-access budget (plan §6.1 Data access; rule PF-1; plan `ee1aa26`):
    - A request path runs **at most 5 database statements**.
    - It makes no PDS round trip it does not need. A read makes one.
    - Publish (P2.23, run per batch by P2.22) makes exactly its named calls: the reads it lists, the changed blobs'
      uploads, then one `applyWrites` with `swapCommit` and a CID compare.
    - No query or PDS call sits inside an unbounded loop.
    - Each index carries its query in a migration comment, and a change made for speed carries p50/p95/p99 evidence
      (P1.11, P0.09c).
    Checked by P1.11's `query_budget_per_route` and P2.23's `publish.exact_pds_calls`.

## Readable, reusable code (Alex, 2026-10-02)

Alex wants a clean codebase that a person can read and understand, with functions reused rather than repeated.
Every step is designed so its code follows these rules, and its tests or CI guards check them where they can.

**Shape**
1. **Functional core, thin shell.** The algorithm of a step is a set of pure functions (input → output, no I/O).
   Database, network, clock, randomness and files are passed in as small named dependencies at the edge. Pure parts
   are unit-tested without mocks; the shell gets a few integration tests.
2. **One feature per folder** inside its owning top-level folder (`domains/identity/sessions/`, `shared/http/csrf/`), named for what it does (`csrf/`, `sessions/`, `publish/`), each with a short
   `README.md`: what it does, why, its public functions, and the step ids that built it.
3. **Small units.** A function does one job at one level of abstraction and usually fits on a screen; do not split
   it to meet a line count (decision 35 D1, rule DC-1: Biome `noExcessiveCognitiveComplexity` at warn, P0.05). A file
   stays under about 300 lines (lint warning). A workspace exports only what other workspaces use, through one
   `index.ts`.
4. **Plain TypeScript.** No decorators, no dependency-injection container, no metaprogramming, no clever generics.
   Dependencies are function parameters. If a reader needs to know a framework trick to follow the code, rewrite it.

**Names and comments**
5. Full words, verbs for functions (`verifyHandle`, `sealTokenSet`), nouns for data. Domain words come from
   `03-glossary.md` and are spelled the same everywhere.
6. Each exported function has a short doc comment: purpose, inputs, output, the errors it returns. It matches the
   interface shape written in its step.
7. Comments explain **why**, not what, and cite their source: the plan section, the spec URL, the reference
   client file:line, or the step id (`// P1.07: exact Origin match, never by suffix (plan §2 rule 14)`). Before
   relying on how a library, API, tool, protocol or service behaves, read its current official documentation for
   the pinned version and cite it; until a test proves it, the behaviour is unverified (DO-3).

**Errors**
8. Expected failures are returned as typed results (`{ ok: false, error: "state_mismatch" }`) with a code from the
   error catalog; exceptions mean a bug. No empty `catch`, no swallowed error, no fallback that widens access.
8a. **Retry rule** (plan §6.1 Deadlines; rule RE-1). An outbound call is retried **at most once**, and only when all
   of these hold:
   - the call is idempotent (a read, or a write made idempotent by a pre-chosen key, rkey or submission id);
   - the failure is transient (timeout, connection error, 5xx; never a 4xx or a 429);
   - the retry fits inside the caller's deadline (the request's `ctx.deadline`, or a job's or script's stated budget).
   No layer above or below retries the same call. Each site writes this in place and cites "README rule 8a". There is
   no shared `retry()` helper (reuse rule 9; findings F-10). The plan's "one `retry()` helper" wording is with the plan
   thread.

**Reuse (aligned with Alex's architecture principles 11 and 12, 2026-10-03)**
9. Clarity before reuse. A step does not design a shared abstraction because two pieces of code look alike.
   `02-shared-blocks.md` lists only the **security mechanisms that must exist exactly once** (invariant 2: egress
   guard `guardedFetch`, CSRF/Origin gate, seal (`seal`/`sealStream` and `sealTo`/`sealToStream`), `verifyHandle`,
   `eraseDid`, `appendAudit`, `RateLimiter`, lexicon validator, props serialiser, CSP builder, config loader), each
   owned by one step. Everything else is extracted only when the same concept
   repeats for the same reason and the extraction makes the code clearer (first occurrence: keep it simple;
   repeated: observe; stable common concept: consider extracting).
10. CI runs a duplicate-code report as **advice to the reviewer**, never as a failing gate; a second copy of one of
   the mechanisms in rule 9 does fail review.

**Traceability**
11. One step is one pull request. Its title and every commit subject are the step id plus a capitalised, imperative
    summary with no trailing period (`P1.07 Enforce exact Origin match in CSRF gate`; Chris Beams' rules, no
    Conventional Commits prefix; decision 35 D2, rule DL-6); the kind of change is a PR label. Merges are squash-only:
    the squash subject is the PR title and its body the commit messages. A PR warns above about 400 changed source
    lines and fails above 800 unless labelled `large-pr` with a reason (tests, lockfile, generated code and lexicon
    JSON excluded; D3, rule DL-1). At most three agent PRs wait for Alex at once, severity-1 and -2 fixes excepted (D4).
    The `large-pr` label is only for a change that cannot be cut without leaving a half-working step; a pure function
    with no caller yet (P0.09e) is a valid cut (ruling 2026-10-05). A step that changes a check path and a product path
    together splits: its check part lands first as `<id>q`, and the step depends on it (rule SE-6, ruling 2026-10-05
    01:15Z; beside `<id>k` for a trusted-base change and `<id>g` for a grants change). A step whose guard, CI or hook
    work touches only check paths, tooling, scripts, tests and docs stays one step. Only the `scripts/` folders whose
    code decides pass or fail are check paths; a script CI runs to pass or fail moves under one (ruling 01:43Z), while
    generators and developer tools stay outside.
    The checks are P0.09c's. Its description follows the one PR template (P0.09; rule DL-3) and links the step. A
    human can go from any file to the step that explains it, and back.

## How the review works

1. Writer agents draft each phase file from the plan and `01-outline.md`.
2. For each phase, a **logic reviewer** attacks the algorithms (missing branches, wrong order, untestable
   "done", contradictions with the plan) and a **reuse reviewer** checks the prototype and libraries for
   salvage candidates. Their reports go in `reviews/`.
3. The writer answers each finding: fixed (with the change) or rejected (with the reason).
4. A second round checks the answers. A finding still open after two rounds goes to Alex.
5. Gaps in the plan itself go to `plan-issues.md` and through the coordinator to the plan thread; this book
   never edits the plan.

## Editor pass (2026-10-03)

- Status line: the plan now has decisions 1–23 folded in.
- Files: `phase-1.md` and `phase-4.md` merged (the part files are pointers); `02-shared-blocks.md` described as the
  invariant-2 catalog only; `editor-todo.md` listed.
- Tags: `[PERMANENT]` defined (used by P1.31, P1.32, P1.34, P1.35 and not defined before).
- New section "Alex question labels" (editor resolution 9).
- Invariant 2: `profileHref` is owned by P3.12 and `safeHref` by P1.24 (the editor sweep's owners); `profileHref` had no owner before.
- Invariant 3: the staff tailnet address exception, limited to the places P3.17 lists (phase-3 PI-2).
- Reuse rule 9: names `guardedFetch`, `seal`/`sealStream`, `sealTo`/`sealToStream`, `appendAudit` and `RateLimiter`
  (editor resolution 4).

## Editor pass (2026-10-04, decision 34)

- Decision 34 (Alex, 2026-10-04 04:39Z, "Apply all"): the *Architecture and Development Guideline* is the fourth
  governing guideline. New `layout-map.md` (old path → new path, reason, open points O-1 to O-11).
- Depth of detail: refine steps record feature ownership paths; new "Slices" paragraph (first slice and its exit P2.13a).
- Step template: `Where:` names the decision-34 folder; new `Feature:` line (ownership path; first slice writes
  `docs/human/features/<feature>.md`).
- Invariant 11: test placement (unit next to code, `tests/integration/`, `tests/e2e/`). New invariant 13: layout and
  boundary rules.
- Readable-code rules 2 and 3: folder and workspace wording.

### Editor pass (2026-10-04 05:10Z refinement, decision 34)

- Layout open points resolved by the architecture thread (guideline §1 refined 05:10Z; `layout-map.md`): invariant 13 now states the SSR, no-interface-to-interface, zero-dependency-allowlist and one-adapter-per-SDK rules.

## Editor pass (2026-10-04, findings)

- Step template: new `Threats:` heading for `[SEC]` steps, with the rule for which phases carry it (reviewer findings
  F-26, `../architecture-handoff/step-book-findings.md`; triage in `reviews/step-book-findings-triage.md`). Kept to
  STRIDE lines that point at existing tests; the findings' data-flow diagram and LINDDUN table were not adopted (they
  come from the engineering-rules draft, which Alex has not adopted).

## Editor pass (2026-10-04, decision 35)

- Decision 35 (Alex, 2026-10-04 12:56Z, "Adopt all"): the *Engineering Rules* are the fifth governing document
  (status line; ADR 0002 in the repository; the plan wins over a rule, the architecture guideline wins on structure).
- Readable-code rule 3 reworded (D1, finding F-35); rule 11 now carries the commit and PR-title form, squash settings,
  PR size and review-queue cap (D2, D3, D4; finding F-34), checked by the new step P0.09c.
- English first (Alex, step-book card 12:58Z): new "English first" paragraph under "Depth of detail"; invariant 8 gains
  the slice-1 exception (messages modules, English-only tests until the i18n slice).

## Editor pass (2026-10-04, bibliography review)

- New readable-code rule 8a, the **retry rule** (plan §6.1 Deadlines, rule RE-1): at most one retry, only for
  idempotent calls and transient failures, and only inside the caller's deadline. P2.07, P1.35's monitor and P5.02a cite
  it. There is no shared `retry()` helper (rule 9, F-10). The plan's "one `retry()` helper" wording is with the plan thread.
- New invariant 14, the **data-access budget** (plan §6.1 Data access, `ee1aa26`): at most 5 statements per request
  path, no PDS round trip the path does not need, publish makes exactly its named calls, index query comments and
  p50/p95/p99 evidence. Checked by P1.11 `query_budget_per_route` and P2.23 `publish.exact_pds_calls`.

### Editor pass (2026-10-04 evening)

- AI notes upkeep (plan §7, Alex 2026-10-04 22:11Z): every step's done-check includes "AI notes updated or none
  needed" (template line above; it applies to every step whether or not its text repeats it); each `P<n>.00` refine
  step (and L.00) includes a notes tidy pass. The vault and its guard are P0.09d; P0.09a (bulk carry) is retired.
- Decisions 40 and 41: there is no GitHub-enforced protection on `main` while the repository is private on the free
  plan; agents never merge and never push to `main`; Alex alone merges (`CLAUDE.md`, ADR 0009). Wherever a step says
  "Alex's approval merges" or "the ruleset blocks", read "Alex merges" and "waiting until protection exists".
