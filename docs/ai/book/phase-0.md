# Phase 0 — Repository and guard rails

Status: **writer round 2** (answers [`reviews/r1-phase-0.md`](reviews/r1-phase-0.md); see "Round 2 changes" at the end).
Build-ready under "detail by risk". Planning only; no code. Template, tags and invariants: [`00-README.md`](00-README.md).
Step ids and dependencies: [`01-outline.md`](01-outline.md). Source of truth: [`../unset-sh-rebuild-plan.md`](../unset-sh-rebuild-plan.md)
§8 Phase 0, §6.1, §7, §9, §2 rules 13, 22–27. Engineering rules: Alex's architecture instructions, the engineering
practices addendum and, since decision 35 (2026-10-04), the *Engineering Rules* (`engineering-rules.md`, ADR 0002; all
in the bundle under `docs/human/engineering/`); §5 of the addendum ("use established libraries … do not
reinvent proven solutions") decides every "own code or tool" choice below.

**Goal of the phase.** Put the private `unset.sh` repository on GitHub with the bootstrap history, a `main` that only
Alex merges into (by written rule while GitHub offers no protection on the free private plan, decisions 40 and 41), and a CI that blocks the classes of mistake the prototype shipped (secrets, bare
egress, `Domain=` cookies, silently skipped tests, unpinned or confusable dependencies, workflows that can reach
secrets). In parallel Alex does the things only a human can do once: domains, hardware-key 2FA, the offline key
ceremony, and the licence question.

**Phase exit (plan §8 Phase 0, as restated for decisions 40 and 41):** CI passes and blocks a planted secret, a planted
bare `fetch` and a planted `Domain=` cookie; every action is pinned by SHA; the Actions token is read-only and Actions
cannot approve PRs; and the main-branch rules (PR only, squash only, agents never merge and never push to `main`, Alex
alone merges) are written in `CLAUDE.md` and ADR 0009. A GitHub-enforced protected `main` is **not** part of the exit
while the repository is private on the free plan (decision 41: GitHub refused rulesets; Alex chose "Go without").
P0.14 proves what exists on GitHub itself and marks the two protection checks "waiting until protection exists".

**Decisions 40 and 41 (Alex, 2026-10-04 20:09Z and 20:45Z; ADRs 0008 and 0009).** Agent PRs are opened under Alex's own
GitHub identity, so GitHub can never count an approval on them: the target ruleset requires a PR and green checks, blocks
force-push and deletion, applies to admins, with **zero** required approvals and no code-owner review (decision 40).
P0-A1's separate agent identity is dropped: agents open PRs as Alex and never merge; Alex alone merges. CODEOWNERS stays
for routing and the record. GitHub then refused any ruleset on a private free-plan repository and Alex chose to go without
(decision 41), so `main` has no ruleset and no branch protection today; the decision-40 ruleset is kept as a one-command
step (P0.03) to apply the day protection is available, and the launch gate checks it is (L.04).

**State the phase starts from.** The bootstrap bundle `/mnt/project-files/unset-plan/bootstrap/unset.sh.bundle`. The
bundle keeps changing while the plan is discussed, so the book does not hard-code its tip. P0.02 reads the bundle at
run time and compares it with this recorded expectation; when they differ, P0.02 step 3 says when the agent may update
the record and when it must stop.

| Field | Recorded value | Recorded |
|---|---|---|
| Ref that `HEAD` names | `refs/heads/claude/project-thread-t0o2p9` | 2026-10-04 evening (editor pass A; as built) |
| Tip | `24470d58e1971b8ddc30dda852e82d720673d4e4` (2026-10-03 12:04Z) | same |
| Commit count (`git rev-list --count <tip>`) | 51 | same |
| Root (`git rev-list --max-parents=0 <tip>`) | `3edd0ded0eab96727e1ecd5f18fd9c2328cbd9fd` (GitHub's "Initial commit"; the bootstrap history was rebased onto it) | same |
| What reached `main` | PR #1 merged tip `e1d7bcd` (80 commits, same root) as `6e9a02b` at 18:42Z; `main` has one root | same |

**As built (2026-10-04).** The repository was not empty when the bootstrap arrived (GitHub had made an "Initial
commit"), so P0.02's push became PR #1, a merge rather than an empty-repository push; draft PR #5 is the rest of P0.02
(the reconciliation ADR, **0007**). The older record (tip `ed1dd81`, 41 commits, root `baa2768`) is superseded.

What the bundle contains at that tip: `docs/ai/PLAN.md` (the plan; P0.02 step 9 re-diffs it), ADR 0001 (Phase 0 defaults;
it already records plan gaps 1–9 as adopted and decisions 20–22; decision 22 is the pause-and-ask rule: on a 413 from a
foreign PDS the 720p rendition is **offered to the user, never automatic**), `docs/human/engineering/` (Alex's architecture
instructions, engineering practices addendum, workflow and change management), `.nvmrc` = `24`, `typescript` `6.0.3`,
`@types/node` `24.19.1`, tests on `node:test` through `scripts/guards/run-tests.ts` + `file-reporter.ts`, Dependabot,
CI jobs `check` + `secrets` (gitleaks-action), `.github/CODEOWNERS` = `* @Undefined6799`. Plan issue #9 (TS 7, Node 26,
Vitest, full CI list) is fixed by P0.04–P0.08 and P0.09c.

Since decision 35 (plan thread commit `1016b44`, 2026-10-04; the bundle in the planning folder still shows an older tip, so
P0.02 step 3c's docs-only rule applies) the bundle also carries: `docs/human/engineering/engineering-rules.md` and
`engineering-rules-top-15.md`; ADR **0002** = the engineering rules (decision 35 in full); ADR 0001 as an **append-only
decisions log** (D8) that already has entries for decision 35 and English first; and a `CLAUDE.md` that imports the
top-15 file, states the precedence rule (the plan wins over a rule; the architecture guideline wins on structure) and has
a Delivery section (D1, D2, D3, D4, D8). ADR numbers on `main` or in open PRs (2026-10-04 evening): 0001 decisions log,
0002 engineering rules, 0003 decision 36, 0004 decision 37, 0005 decision 38 (Spaces), 0006 decision 39, **0007 the
bootstrap reconciliation (P0.02, draft PR #5)**, 0008 decision 40, 0009 decision 41, 0010 decision 42 (PR #12). The next
free number is **0011**, which the architecture table already gives the no-orchestrator ADR (P0.09).

```mermaid
flowchart TD
  P001["P0.01 create repo + Claude app [ALEX]"] --> P002["P0.02 push bundle tip, reconcile"]
  P002 -->|"right after the push"| P003["P0.03 ruleset, Actions settings, CODEOWNERS [ALEX][SEC]"]
  P003 --> P004["P0.04 TS 7, Node 26, Vitest, discovered=executed"]
  P004 --> P005["P0.05 Biome CSS, dependency-cruiser (swc), budgets"]
  P005 --> P006["P0.06 repo guards as Vitest [SEC]"]
  P006 --> P007["P0.07 CI workflow + required checks [SEC][ALEX]"]
  P007 --> P008["P0.08 Renovate, pins, lockfile [SEC][ALEX]"]
  P003 --> P009["P0.09 repo docs"]
  P009 --> P009a["P0.09a carried notes"]
  P007 --> P009b["P0.09b severity, labels, bug template"]
  P009b --> P009c["P0.09c commit, PR size, PR template checks [ALEX tail]"]
  P006 --> P009d["P0.09d AI notes vault + notes guard (parallel-safe)"]
  P009 --> P009c
  P008 --> P009c
  P003 --> P010["P0.10 secret scanning, 2FA, allowed-signers [ALEX][SEC]"]
  P011A["P0.11 domains: Alex part (day one) [ALEX]"] --> P011B["P0.11 agent PR part"]
  P007 --> P011B
  P010 --> P012A["P0.12 key ceremony: Alex part [ALEX][SEC]"]
  P012A --> P012B["P0.12 agent PR part (key inventory)"]
  P007 --> P012B
  P013{"P0.13 licence [STOP]"}
  P007 --> P014["P0.14 exit drill [ALEX tail]"]
  P008 --> P014
  P010 --> P014
```

The Alex halves of P0.11 and P0.13 can start on day one. P0.12's ceremony waits for P0.10's hardware keys. Every
repository artefact (a file plus its Vitest test) waits for P0.07, because "done" includes the PR's required checks.

---

### P0.01 — Create the empty private repository and grant the Claude GitHub app access
Tags: [ALEX]            Depends on: —            Plan: §8 Phase 0 ("Create the GitHub repo"), §9
Where: GitHub (no files)
Size: 0 source lines, 0 test lines (a checklist)

Goal: an empty private repository `unset.sh` exists under Alex's account and the Claude GitHub app can push branches,
including workflow files, and open pull requests in it, and nothing else.

Inputs: Alex's GitHub account (`Undefined6799`) with hardware-key 2FA already on (if it is not, do P0.10 step 1 first).
Outputs: `github.com/Undefined6799/unset` (as built: the repository is named `unset`; GitHub added an "Initial commit",
see P0.02) (private, default branch `main`); the Claude GitHub app installed on
this one repository only.

Algorithm (the runbook Alex follows):
  1. GitHub → New repository. Owner `Undefined6799`. Name `unset.sh`. Visibility **Private**. Do **not** add a README,
     `.gitignore` or licence (the repository must be empty so P0.02 can push the bundle history unchanged).
  2. Settings → General:
     a. Default branch name `main`.
     b. Features: Wikis off, Projects off, Discussions off, Sponsorships off. Issues on.
     c. Pull Requests: allow **squash merging only** (merge commits off, rebase merging off), with "Default commit
        message" = **Pull request title and commit details** (squash subject = PR title, body = the commit messages;
        decision 35 D2); "Always suggest updating
        pull request branches" on; "Allow auto-merge" **off** (agents must never be able to arrange a merge);
        "Automatically delete head branches" on.
  3. Settings → Code security: Dependency graph on; Dependabot alerts on; Dependabot security updates **off** (Renovate,
     P0.08, opens update PRs; two bots would duplicate them). Secret scanning and push protection are P0.10.
  4. Install the Claude GitHub app: GitHub → Settings → Applications → Claude → Configure → Repository access **Only
     select repositories** → `unset.sh`. Do not grant "All repositories". Expected permissions: Contents read/write,
     Pull requests read/write, Issues read/write, **Workflows read/write** (required: the very first push contains
     `.github/workflows/ci.yml` and P0.07 rewrites it; GitHub refuses workflow-file changes from an app without it),
     Metadata read, Checks and Actions read. The risk of Workflows write is that an agent branch can change what CI
     runs; P0.03 (Actions settings) and P0.07 (no repository secrets, OIDC bound to `main`) are the controls.
     If it asks for **Administration** write or anything beyond this list → stop and tell the agent.
  5. Tell the agent the repository URL and that step 4 is done.

Edge cases and failures:
  - The name `unset.sh` is rejected or taken → stop; Alex picks the name; the agent updates every reference.
  - The repository was created with a README → delete and recreate it empty (a force-push over it is not allowed later).
  - The Claude app cannot be limited to one repository → stop; do not install it account-wide.

Done when (tests): (the agent verifies after Alex reports done)
  - repo_is_private_and_empty: `gh repo view Undefined6799/unset --json visibility,isEmpty` → `PRIVATE`, `true`.
  - merge_settings: `gh api repos/Undefined6799/unset` → `allow_squash_merge = true`, `allow_merge_commit = false`,
    `allow_rebase_merge = false`, `allow_auto_merge = false`, `delete_branch_on_merge = true`,
    `squash_merge_commit_title = "PR_TITLE"`, `squash_merge_commit_message = "COMMIT_MESSAGES"` (D2; findings F-34).
  - app_scope: `gh api /installation/repositories` (as the app) lists exactly one repository, `unset.sh`.
  - app_permissions: the installation's `permissions` object (`gh api /installation` is not callable by the app
    itself, so Alex pastes the app's permission page) contains no `administration: write`.

Reuse: none.
Not in this step: the ruleset and Actions settings (P0.03); secret scanning, push protection, 2FA (P0.10); any file
content (P0.02).
Diagram: none.

---

### P0.02 — Push the bootstrap bundle tip and reconcile it with the revised plan
Tags: —            Depends on: P0.01            Plan: §8 Phase 0; plan-issues #9; ADR 0001
Where: the repository root; new `docs/human/decisions/0007-bootstrap-reconciliation.md`; edits to `README.md`, `docs/human/decisions/README.md`
Size: ~0 source lines, ~120 lines of docs, 0 test lines

Goal: the bundle's full history up to its `HEAD` tip is on `main` unchanged, and one reconciliation PR records exactly
which bootstrap files the later Phase 0 steps change, and which plan items are deferred.

**As built (editor pass, 2026-10-04 evening).** GitHub had already made an "Initial commit" (`3edd0de`), so the
bootstrap was rebased onto it and arrived as **PR #1**, a merge (tip `e1d7bcd`, 80 commits, merged as `6e9a02b` at
18:42Z), not as the empty-repository push of steps 4–6. Steps 1–7 are done in that form; **draft PR #5** is the rest of
this step (steps 8–9, ADR **0007**). The README layout table also came in PR #1. Phase 0 has no separate folder-layout
step: folders appear with their first code (P1.01).

Inputs: P0.01 done; the bundle file; the recorded expectation in this file's header; the plan; this book.
Outputs:
  - `main` at the bundle's `HEAD` tip, history intact (41 commits at the recorded tip).
  - PR `claude/p0-02-reconcile` containing:
    - `docs/human/decisions/0007-bootstrap-reconciliation.md` (0001–0010 are taken; 0007 is this ADR). ADR 0001 already
      records gap 9 as adopted, so the reconciliation ADR records
      only file-level changes, as a table `item | bootstrap value | new value | why | owning step`:
      Node (`.nvmrc` `24` → exact `26.x.y`, decision 16, P0.04); TypeScript (`6.0.3` → `7.0.x`, decision 16, P0.04);
      test runner (`node:test` → Vitest only, decision 16, P0.04); `.npmrc` (none → `ignore-scripts`, `@unset` scope
      blocked, P0.04); module boundaries (none → dependency-cruiser with the swc parser, plan §7 and PI-3, P0.05);
      CSS lint (none → Biome CSS rules, §7, P0.05/P1.21); guards (`node:test` → Vitest, P0.06); CI jobs (add `audit`,
      `actionlint`, Semgrep CE, SBOM, duplicates report; gitleaks as CLI image, P0.07); dependency bot (Dependabot →
      Renovate, §6.1, P0.08); CODEOWNERS (single owner → security paths, §9, P0.03); README layout (missing `api`,
      `review`, `admin`, `chat-admin`, §7, this PR).
      A second table, **deferred plan items**: image scan, hadolint, cosign and SLSA attestations "from commit 1"
      (plan §8 Phase 0) → no image exists until P1.27, so they start "from the first image" (PI-5); graphify graphs in
      CI (plan §7, §9) → **P2.13b**, after the slice-1 exit, once the first slice's code exists to graph (PI-2).
      A third line records the bundle facts actually pushed: ref, tip, count, root, date.
    - `README.md`: the layout table lists the top-level folders of plan §7 as decision 34 set them (`apps/{web, admin,
      chat}`, `interfaces/{http, api, indexer, media, review, pds-admin, chat-admin}` with `chat` and `chat-admin` marked
      "Phase 6", `domains/`, `infrastructure/`, `shared/`, `deployment/`, `tests/`, `docs/{human, ai}`; see
      `layout-map.md`); the "Requires Node 24" line is left for P0.04 to change.
    - `docs/human/decisions/README.md`: the reconciliation ADR's row.

Algorithm:
  1. Verify the bundle: `git bundle verify unset.sh.bundle`. Fails → stop and report; never push a partial history.
  2. Read it: `git bundle list-heads unset.sh.bundle`. Let `tip` = the sha on the `HEAD` line and `ref` = the other line
     with that sha whose name is **not** `refs/heads/main` (if only `refs/heads/main` carries it, `ref` = main).
     No `HEAD` line → stop and report. Clone the bundle into the agent's scratch directory; compute
     `count = git rev-list --count <tip>` and `root = git rev-list --max-parents=0 <tip>`.
  3. Compare with the recorded expectation (header table):
     a. `tip`, `count`, `root` all equal the record → continue to step 4.
     b. `root` differs, or more than one root → stop and ask (the history was rewritten).
     c. Else, the bundle moved forward: require `git merge-base --is-ancestor <recorded tip> <tip>` and that
        `git diff --name-only <recorded tip> <tip>` lists only paths under `docs/` plus `CLAUDE.md`, `AGENTS.md` or
        `README.md`. If both hold → the agent updates the expectation (it writes the new values into the reconciliation ADR's bundle
        line and sends them to the coordinator, who updates this header) and continues. If either fails → stop and ask,
        listing the non-doc paths.
     As built (2026-10-04): the bundle had moved to `24470d5` (51 commits) and the history was rebased onto GitHub's
     `3edd0de`, so the root differed (3b); the stop-and-ask was answered by landing it through PR #1 (tip `e1d7bcd`,
     80 commits, same root). The header table now records those values; ADR 0007 records the move and why.
  4. Assert the GitHub repository is still empty (`gh repo view … --json isEmpty` = true). Not empty → stop; never
     force-push.
  5. Push the tip, never the bundle's own `main` ref: `git push origin <tip>:refs/heads/main`. This is the only push to
     `main` in the whole book; it is allowed because the repository is empty and the ruleset does not exist yet.
     Network error → retry up to 3 times with 10 s between tries, then stop. Rejection → stop and report.
  6. Verify: `git ls-remote origin refs/heads/main` = `tip`. Differs → stop.
  7. Tell Alex at once that P0.03's ruleset can be created now (F15: the unprotected window lasts minutes, not until
     a PR merges). Wait for the bootstrap CI run on `main` (`gh run watch`, timeout 30 min). It fails → record the
     failure in the reconciliation ADR; do not fix it in this PR. Timeout → record "not finished" and continue.
  8. After Alex reports the ruleset active: create a worktree from fresh `origin/main` on `claude/p0-02-reconcile`,
     write the three files, run `npm ci && npm run check`, commit, push, open the PR. The PR body lists the table rows.
  9. Diff `docs/ai/PLAN.md` against the current plan file. If they differ beyond the trailing newline → copy the current
     plan in, in the same PR, and say so in the PR body; any change to a §2 rule or §8 Phase 0 item is also reported to
     the coordinator before the PR is opened.

Edge cases and failures:
  - The bundle's `main` ref differs from `HEAD` (it does today: `main` is the 1-commit root) → step 2 picks `HEAD`'s ref;
    pushing `main` would publish one commit.
  - The bundle moved forward with docs-only commits → step 3c updates the record; nothing stops.
  - `npm ci` fails on the bootstrap lockfile → stop; do not regenerate the lockfile in this PR (P0.04 does).
  - Alex has not created the ruleset when step 8 is reached → wait; the PR is opened only against a protected `main`.

Done when (tests): (agent verification; the commands and outputs go in the PR body)
  - bundle_ref_chosen: the sha pushed equals the `HEAD` line of `list-heads`, not the `refs/heads/main` line.
  - history_intact: `git rev-parse origin/main` = `tip`; `git rev-list --count origin/main` = `count`; root =
    `baa2768…`; all three equal the expectation as recorded (or as updated in step 3c, with the update in the reconciliation ADR).
    As built: `main` has one root, `3edd0de`, and contains `e1d7bcd` (PR #1, merged as `6e9a02b`); ADR 0007's bundle
    line records ref, tip `24470d5`, 51 commits, the rebase onto `3edd0de` and the PR #1 merge.
  - reconcile_pr_green: the PR's `check` and `secrets` jobs pass.
  - adr_rows_complete: the reconciliation ADR has one row per item above, each naming an owning step id that exists in
    `01-outline.md`, plus the deferred table (PI-2, PI-5) and the bundle line (checked by reading the file in review).

Reuse: bootstrap bundle → USE (it is our own Phase 0 work). Provisional — for reuse review.
Not in this step: changing `.nvmrc`, `package.json`, `.npmrc`, the test runner (P0.04); CI jobs (P0.07); CLAUDE.md (P0.09).
Diagram: none.

---

### P0.03 — Ruleset on `main`, repository Actions settings, CODEOWNERS with security-review paths
Tags: [ALEX] [SEC]            Depends on: P0.02 step 5 (the push; not the reconcile PR)            Plan: §8 Phase 0, §9, §5.7; admin design §6.3, §11
Where: GitHub Settings → Rules and → Actions (Alex); `.github/CODEOWNERS` (agent, by PR, after the ruleset exists)
Size: ~50 lines of CODEOWNERS, 0 test lines

Goal: GitHub Actions in this repository can only run GitHub-owned actions with a read-only token and can never approve
a PR; CODEOWNERS names the security-review paths (routing and record, decision 40); and the decision-40 ruleset (PR
required, green checks required, no force-push, no deletion, admins included, zero approvals, no code-owner review) is
ready to apply with one command the day GitHub offers protection on this repository.

**As built (decisions 40 and 41, editor pass 2026-10-04 evening).** GitHub refused the ruleset ("Upgrade to GitHub Pro
or make this repository public to enable this feature"); a private free-plan repository gets no rulesets and no branch
protection, and Alex chose "Go without" (decision 41, ADR 0009). Record that refusal in the CODEOWNERS PR. The Actions
settings (step 5) are **done**: token read-only, Actions cannot approve PRs. Until protection exists, PR-only,
squash-only, agents-never-merge and no-direct-push are written rules (`CLAUDE.md` Delivery, P0.09; ADR 0009).

Inputs: P0.02 step 5 done; job names `check` and `secrets` from the bootstrap `ci.yml`; the bootstrap
`.github/CODEOWNERS` (`* @Undefined6799`), which already makes "require review from Code Owners" work from the first
commit.
Outputs:
  - Ruleset: **not created** (GitHub refused it, decision 41); the refusal text is recorded in the CODEOWNERS PR body.
    The decision-40 ruleset body and its one `gh api` command are kept in step 1 below, applied the day protection is
    available (Pro plan or a public repository; the launch gate's L.04 checks it is).
  - Actions settings set (step 5; done).
  - Agent PR `claude/p0-03-codeowners`: `.github/CODEOWNERS` with `* @Undefined6799` as the default line plus one
    commented section per security area, each owned by `@Undefined6799` (one owner today; a second owner is added to
    these lines when one exists). Paths follow the decision-34 layout (`layout-map.md`). Sections:
      identity `/domains/identity/`; auth and sessions `/domains/identity/auth/`, `/interfaces/http/session-cookie.ts`,
      `/infrastructure/pds/`; request security `/shared/http/` (server kit: CSRF gate, CSP, limits, client IP,
      return path); admin envelope `/shared/admin-envelope/`; crypto `/infrastructure/seal/`; audit
      `/infrastructure/audit/`; config `/shared/config/`; legal hold and media safety `/domains/moderation/`,
      `/infrastructure/arachnid/`, `/interfaces/legal-hold-export/` (P4.07's offline export of sealed hold records; the
      legal-hold seal path is `/infrastructure/seal/` plus these); boundary rules `/.dependency-cruiser.cjs`;
      islands and links `/shared/ui/islands/`, `/shared/ui/src/islands/` (props serialiser, P1.10),
      `/shared/ui/safe-href.ts` (P1.24);
      egress `/infrastructure/net-guard/`; database `/infrastructure/postgres/`; entrypoints `/apps/admin/`,
      `/interfaces/admin/`, `/interfaces/pds-admin/`,
      `/interfaces/media/`, `/interfaces/api/`, `/interfaces/review/`, `/interfaces/indexer/` (erasure), `/interfaces/chat-admin/`, `/interfaces/{jobs,audit-verify,chat-auth}/` (`jobs` runs all
      scheduled work, retention included, R5-01);
      chat `/apps/chat/`, `/infrastructure/matrix/`, `/domains/messaging/`;
      lexicons and permission set `/shared/lexicons/`; supply chain `/.github/`, `/deployment/`, `/package-lock.json`,
      `/.npmrc`, `/renovate.json`; edge `/deployment/edge/` (named on its own line after `/deployment/`, so the SE-6
      list maps one to one); repo guards `/scripts/guards/`, `/scripts/test/`; key and account runbooks
      `/docs/human/runbooks/`.
    **Order: broad before narrow.** GitHub applies the *last* matching line, so a broader path always comes before
    the narrower paths inside it: `/domains/identity/` before `/domains/identity/auth/`, `/deployment/` before
    `/deployment/edge/`, `/infrastructure/postgres/` before any file under it (the PR #7 review). The sections above are
    written in that order (identity before auth and sessions; supply chain before edge), and the test
    `codeowners_broad_before_narrow` enforces it.
    Plus one section headed exactly `# trusted base (SE-6)`, the machine-read list for P0.09c's `trusted-base`
    check (rule SE-6). It is the **last** section of the file and runs from its heading to the end of the file with no
    blank line inside (P0.09c's parser reads it that way; a line after it or a blank line inside it fails). Its
    patterns, one per SE-6 entry: CSRF gate and session `/shared/http/`,
    `/domains/identity/auth/session-store.ts`, `/interfaces/http/session-cookie.ts`; `verifyHandle`
    `/domains/identity/verify-handle.ts`; `net-guard` `/infrastructure/net-guard/`; serialiser
    `/shared/ui/islands/props.ts`, `/shared/ui/src/islands/readProps.ts`; `safeHref` `/shared/ui/safe-href.ts`; seal
    `/infrastructure/seal/`; CSP builder (inside `/shared/http/`); media sandbox headers `/interfaces/media/headers.ts`
    (P3.09 keeps them in that one file); roles and grants on objects that already exist: the role roster
    `/infrastructure/postgres/roles.json` as a whole path, and one comment line `# parsed:
    /infrastructure/postgres/migrations/ /infrastructure/postgres/grant-matrix.json
    /infrastructure/postgres/erasure-registry.json`, plus one comment line `# trusted functions: core.erase_*
    core.is_erased core.allow_retrack core.is_held mod.erase_foreign_did` (the `eraseDid` SQL, rule 3f; `core.is_held` is
    the first of the legal-hold definers). SE-6 names three function families as trusted base even when new: the
    `eraseDid` family, the `audit/` append functions and the legal-hold definers including `core.is_held`. **The line
    grows in the same trusted-base step that first names a function:** P1.15 adds the audit append function(s) it
    creates; P4.07k and P4.07h add the legal-hold definers. Until a family has names, P0.09c's classifier treats any new
    function in schema `audit`, and any `SECURITY DEFINER` function in a legal-hold migration (file name containing
    `legal-hold` or `legal_hold`, or a body naming a `legal_hold` table), as trusted base (fail closed; P0.09c rule
    3f), for which P0.09c's grant parse decides statement by statement and
    row by row whether a change is trusted base (SE-6 as ruled 2026-10-04 and on the follow-ups; plan §9 at
    `6275827`); the cluster bootstrap that creates `migrator` and `tap` and revokes `PUBLIC`'s rights
    `/deployment/postgres/init/` (whole path: it runs as the superuser at `initdb`, before any migration exists, so it
    cannot go through the parse; P1.11g); `audit/` append `/infrastructure/audit/`; `eraseDid`
    `/interfaces/http/jobs/erase-storage.ts` (its existing `erasure-registry.json` rows go through the `# parsed:` line),
    `/interfaces/indexer/erase-untrack.ts`; `/shared/admin-envelope/`, `/interfaces/pds-admin/`,
    `/interfaces/chat-admin/`, `/interfaces/chat-auth/`; lexicons and permission set `/shared/lexicons/`; the
    legal-hold seal path `/domains/moderation/legal-hold/`, `/interfaces/legal-hold-export/`; `/deployment/edge/`.
    A pattern for a file that does not exist yet is kept (P1.01's warning test prints it). The security-review section
    above keeps `/infrastructure/postgres/` whole, so every migration, new tables and functions included, still needs
    CODEOWNERS review; only the isolation rule is narrowed (plan §9 at `f9b48f8`).

Algorithm (the runbook Alex follows, as soon as the agent reports P0.02 step 5):
  Steps 1–4 are **deferred until protection exists** (decision 41: GitHub refused rulesets on the private free-plan
  repository). They are the decision-40 ruleset, kept so it can be applied with one command the day the repository is
  on a plan that allows it or is public: `gh api -X POST repos/Undefined6799/unset/rulesets --input <the body below>`,
  then the agent runs the `ruleset_*` and `direct_push_refused` checks. When GitHub refuses, record the refusal text in
  the CODEOWNERS PR and go to step 5.
  1. Settings → Rules → Rulesets → New branch ruleset. Name `main protection`. Enforcement **Active**.
  2. Bypass list: **empty** (admins included; plan §8). Do not add the repository admin role, any app or any team.
  3. Target branches: "Include default branch".
  4. Rules, all on:
     a. Restrict deletions. Block force pushes. Require linear history.
     b. Require a pull request before merging: required approvals **0** and **no** code-owner review (decision 40,
        ADR 0008: agent PRs carry Alex's own identity, and GitHub never lets an author approve their own PR, so a
        required approval would block every agent PR); require conversation resolution before merging. Allowed merge
        methods: Squash. Alex alone merges, by written rule (`CLAUDE.md`).
     c. Require status checks to pass: "Require branches to be up to date before merging" on (P0-A8); add `check` and
        `secrets`, each with source **GitHub Actions** chosen in the picker (not "any source"), so no other app can
        post a green context. P0.07 adds the others.
     d. Require signed commits: **on**. Under squash-only merging GitHub creates and signs the commit that lands on
        `main`; unsigned commits on agent branches do not matter. P0.14 drill D checks the merged commit is verified;
        if it is not, Alex turns this off and P0-A3 is asked.
  5. Settings → Actions → General (**done**, decision 41 record):
     a. Actions permissions: "Allow Undefined6799, and select non-Undefined6799, actions and reusable workflows" with
        only "Allow actions created by GitHub" ticked; no verified-creator actions; no patterns. (Every third-party tool
        runs as a container image pinned by digest inside a `run:` step, P0.07, so no third-party action is needed.)
        **Ordering (PR #7 review):** 5a waited until P0.07 had merged, because P0.07 replaces the bootstrap's
        third-party `gitleaks/gitleaks-action` with the gitleaks CLI image; there is no temporary allowance for the
        third-party action. P0.07 and P0.08 have both merged, so 5a no longer waits on anything: apply it now.
     b. "Require actions to be pinned to a full-length commit SHA": on, if the setting is offered for this repository.
        Not offered → record "n/a" in the runbook; P0.07's `workflow-pins` test is then the only control.
     c. Workflow permissions: "Read repository contents and packages permissions".
     d. "Allow GitHub Actions to create and approve pull requests": **off**.
     e. Fork pull request workflows: leave defaults (a private repository has no outside forks).
  6. Save. Tell the agent.
  Then the agent opens the CODEOWNERS PR; it goes through the ruleset like every later PR.

Edge cases and failures:
  - Agents open PRs under Alex's own identity (decision 40; P0-A1's separate agent identity is dropped), so no required
    approval can ever be satisfied on them; the ruleset therefore requires zero approvals. Agents never merge and never
    push to `main`; Alex alone merges (`CLAUDE.md` Delivery, P0.09; ADR 0009).
  - GitHub refuses the ruleset ("Upgrade to GitHub Pro or make this repository public") → record the text; steps 1–4
    wait (decision 41); the Actions settings of step 5 still apply.
  - A check name in step 4c does not appear in the picker → it has never run; the bootstrap CI run on `main` (P0.02
    step 7) makes both appear. If it still does not appear → wait for that run, then add it.
  - The picker offers no "GitHub Actions" source for a context → stop and tell the agent; an unpinned source is not
    accepted.
  - The agent's app identity appears as a possible bypass actor → never add it.

Threats: who can change `main`: agents, Actions workflows, other GitHub apps and Alex.
  - E Anyone holding Alex's credentials, agents included, pushes to `main` or merges a PR (decision 41: no ruleset is
    possible on the private free plan). **Accepted for now**, with compensating controls: the read-only Actions token,
    Actions unable to approve PRs (`workflow_token_read_only`), checks on every PR, and GitHub's push and merge log as
    the record; the written rule in `CLAUDE.md` and ADR 0009. Revisit before the repository goes public or before the
    first production account (P5.02), whichever comes first; it must close before production: the launch gate's L.04
    check `main_protection_enforced` requires the decision-40 ruleset active (or the repository on a plan that allows
    it). When protection exists: `ruleset_active`, `ruleset_rules`, `direct_push_refused`.
  - S Another app posts a green context for a required check → each context pinned to the GitHub Actions app
    (`ruleset_rules`, `integration_id = 15368`).
  - T A third-party or retagged action runs in CI → GitHub-owned actions only, SHA pinning (`actions_restricted`;
    P0.07 `all_actions_sha_pinned`).
  - E The workflow token writes to the repository or approves a PR → read-only token, approval off
    (`workflow_token_read_only`).
  - I A repository secret readable by any branch → none exists here (`no_repository_secrets`; P0.07 binds later
    secrets to `main`).
  - R A security path changes without its owner's review → CODEOWNERS sections with code-owner review required
    (`codeowners_valid`).

Done when (tests): (agent verifies with `gh api`; outputs pasted in the CODEOWNERS PR)
  - ruleset_refusal_recorded (decision 41): the CODEOWNERS PR body quotes GitHub's refusal and names ADR 0009.
  - ruleset_active (**waiting until protection exists**, decision 41): `gh api repos/Undefined6799/unset/rulesets` → one
    active ruleset targeting `~DEFAULT_BRANCH`, `bypass_actors` empty.
  - ruleset_rules (**waiting until protection exists**): `gh api repos/…/rulesets/<id>` contains rule types `deletion`,
    `non_fast_forward`, `required_linear_history`, `required_signatures`, `pull_request`
    (`required_approving_review_count = 0`, `require_code_owner_review = false`, decision 40;
    `required_review_thread_resolution = true`, `allowed_merge_methods = ["squash"]`), and `required_status_checks`
    with `strict_required_status_checks_policy = true` and contexts `check`, `secrets`, **each with `integration_id =
    15368`** (the GitHub Actions app).
  - actions_restricted: `gh api repos/…/actions/permissions` → `allowed_actions = "selected"` (and
    `sha_pinning_required = true` if the field exists); `…/actions/permissions/selected-actions` →
    `github_owned_allowed = true`, `verified_allowed = false`, `patterns_allowed = []`.
  - workflow_token_read_only: `gh api repos/…/actions/permissions/workflow` → `default_workflow_permissions = "read"`,
    `can_approve_pull_request_reviews = false`.
  - no_repository_secrets: `gh api repos/…/actions/secrets` → `total_count = 0`.
  - direct_push_refused (**waiting until protection exists**; an agent never pushes to `main` meanwhile, so this is not
    tried before then): the agent pushes one empty commit with `git push origin HEAD:main` → rejected by the ruleset
    (error text recorded). No commit lands.
  - codeowners_valid: after the CODEOWNERS PR merges, `gh api repos/…/codeowners/errors` → `errors = []`.
  - codeowners_broad_before_narrow (PR #7 review; a Vitest in `scripts/guards/change-shape.test.ts` beside P0.09c's
    parser, or P0.03's own test if P0.09c has not merged): for every pair of path lines where one path is a prefix of
    the other, the broader line comes first (GitHub uses the last match); a fixture with `/domains/identity/auth/`
    before `/domains/identity/`, or `/deployment/edge/` before `/deployment/`, fails.
  - codeowners_covers_trusted_base (rule SE-6, as extended 2026-10-04): the `# trusted base (SE-6)` section exists, and
    the PR description maps every SE-6 trusted-base entry (CSRF gate and session; `verifyHandle`, `net-guard`, serialiser, `safeHref`; seal, CSP builder, media sandbox
    headers; roles and grants on existing objects (`roles.json`, the `# parsed:` line and `/deployment/postgres/init/`); `audit/` append, `eraseDid`; `shared/http/`, `shared/admin-envelope/`,
    `pds-admin`, `chat-admin`, `chat-auth`; the lexicons and permission set in `shared/lexicons/`; the legal-hold seal
    path; `deployment/edge/`) to a section above; an entry without one blocks the PR. P1.01's warning test later shows
    whether each pattern matches files.

Reuse: prototype `/home/claude/0x40/.github/CODEOWNERS:1-40` → LESSON (path sections are right; its placeholder owner
`@0x40/security` made the file inert). Provisional — for reuse review.
Not in this step: secret scanning and 2FA (P0.10); the extra required checks (P0.07, Alex tail); the security-path
coverage check (`codeowners_security_paths_match`, a warning-level test added in P1.01 once paths exist).
Diagram: none.

Later edit (SE-6 ruling 2026-10-05, refined 01:15Z; built in P0.09c): the trusted-base section gains one machine-read
line, `# checks:`, listing the check paths: the `scripts/` folders whose code decides pass or fail (`guards`, `lint`,
`ci`, `budgets`, `licence`, `docs`, `test`, `workspace`; each new check folder is added when created), `/.github/`,
`/.githooks/`, `/.semgrep/`, `/.semgrepignore` and `/.dependency-cruiser.cjs`. CODEOWNERS stays the one list.

---

### P0.04 — Toolchain: TypeScript 7, Node 26, Vitest only, `.npmrc`, "discovered equals executed"
Tags: —            Depends on: P0.03            Plan: §7 tooling (decision 16), §2 rule 27, §6.1
Where: `package.json`, `package-lock.json`, `.nvmrc`, new `.npmrc`, `tsconfig.json`, `README.md`, new `vitest.config.ts`,
  new `scripts/test/run.ts`, new `scripts/test/run.test.ts`; delete `scripts/guards/run-tests.ts`,
  `scripts/guards/file-reporter.ts`; port `scripts/guards/guards.test.ts` to Vitest
Size: ~130 source lines, ~150 test lines

Goal: one Node version, one TypeScript, one test runner, install scripts off, the `@unset` npm scope unreachable, and a
test command that fails when any test file anywhere in the repository was found but did not run.

**As built (editor pass, 2026-10-04 evening).** Dependabot PRs merged before this step: #3 TypeScript **7.0.2** (CI
passes), #4 `@types/node` **26.6.3** and #2 `gitleaks-action` 3.0.0 (the action itself is replaced in P0.07). So
TypeScript 7.0.2 is already on `main`; this step keeps that pin rather than bumping it, and its PR body says so.

Inputs: bootstrap `package.json`, `.nvmrc`, `tsconfig.json`, `scripts/guards/run-tests.ts`, `scripts/guards/files.ts`.
Outputs:
  - `.nvmrc` = an exact `26.x.y` (the newest Node 26 release at least 7 days old); Renovate's nvm manager bumps it
    (P0.08). `package.json` `engines.node` = `">=26.0.0"`.
  - devDependencies, exact, each the newest release at least 7 days old at PR time (on 2026-10-03 that is
    `typescript` 7.0.2, `vitest` 5.0.2, `@types/node` 26.6.x): `typescript` `7.0.x`, `@types/node` `26.x.y`,
    `vitest` `5.0.x`, and `vite` (Vitest 5 declares it a non-optional peer; pinning it top-level keeps invariant 10
    literal, and it is the Phase 1 build tool).
  - `.npmrc` (two lines, each with a comment): `ignore-scripts=true` (local installs match CI); `@unset:registry=
    https://127.0.0.1:9/` (the `@unset` scope on npmjs.org belongs to a third party, so it must never resolve remotely;
    a missing workspace then fails closed with a connection error; P0-A5).
  - `vitest.config.ts`: `test.include = ["**/*.test.{ts,tsx,mts,cts}"]`, `test.exclude` = the shared skip list
    (below), `test.passWithNoTests = false`, `test.allowOnly = false` (a committed `.only` fails), `test.retry = 0`
    (a flaky test is a bug, not a retry; findings F-24), `test.projects`
    left for P1.01 (when added, the union of project includes must equal this set; `run.ts` enforces it anyway).
  - Shared skip list `SKIP_DIRS` in `scripts/guards/files.ts`: `node_modules`, `.git`, `dist`, `coverage`, `.worktrees`,
    `graphify-out`, `scripts/guards/fixtures`.
  - `scripts/test/run.ts`, interface:
      `discoverByGlob(root): string[]` — every `*.test.{ts,tsx,mts,cts}` in the **whole repository** except `SKIP_DIRS`,
        repo-relative POSIX paths, sorted.
      `listByVitest(root): string[]` — files from `vitest list --filesOnly --json` (no test collection; only "which
        files does the include select").
      `executedFiles(report: VitestJsonReport): Set<file>` — `{ f : passed(f) + failed(f) ≥ 1 }`, where each assertion
        result's status maps `passed` → passed, `failed` → failed, `skipped | pending | todo | disabled` → skipped.
      `skippedOnly(report): Set<file>` — files with passed + failed = 0 and skipped ≥ 1.
      `skippedCases(report): string[]` — `<file> > <test name>` for every case whose status is skipped, pending, todo
        or disabled in a file that also has a passed or failed case (a skip hidden inside a passing file; findings F-24).
      `strayTestFiles(root): string[]` — files outside `SKIP_DIRS` that look like tests but no include selects:
        `*.spec.*` anywhere except `tests/e2e/` (Playwright's own list, P1.26), and `*.test.{js,mjs,cjs,jsx}`.
      `compare(glob, listed, executed, skippedOnly, skippedCases, stray): { notListed, notExecuted, allSkipped,
        skippedCases, stray }` (sorted string arrays).
      `main(root): exitCode` — 0 only when all five lists are empty and Vitest itself exited 0.
  - `package.json` scripts: `"test": "node scripts/test/run.ts"`, `"typecheck": "tsc --noEmit -p tsconfig.json"`,
    `"guards"` unchanged until P0.06. `tsconfig.json` (and, from P1.01, every project it references) includes the test
    files: no `exclude` entry matches `*.test.*` or `*.spec.*`, so a test that no longer type-checks fails `typecheck`.
  - `README.md`: "Requires Node 26".

Algorithm (`scripts/test/run.ts main`):
  1. `glob = discoverByGlob(root)`. Empty → print "No test files discovered" → exit 1.
  2. Run `vitest list --filesOnly --json` (child process, inherits env, timeout 120 s). Timeout or non-zero exit → print
     stderr → exit 1. Parse stdout as JSON; parse error → exit 1. `listed` = unique `file` fields made repo-relative.
  3. Run `vitest run --reporter=default --reporter=json --outputFile=<scratch>/vitest.json` (timeout 15 min). Keep its
     exit code `vc`. Timeout → exit 1. JSON file missing or unparsable → exit 1.
  4. `executed = executedFiles(report)`; `skipped = skippedOnly(report)`.
  5. `notListed = glob − listed` (on disk, but the include missed it: the prototype's failure mode).
     `notExecuted = listed − executed − skipped` (listed but no passing or failing test: import error, empty file).
     `allSkipped = skipped`. `skippedCases = skippedCases(report)`. `stray = strayTestFiles(root)`.
  6. Print each non-empty list with a heading, one path (or case) per line. Any list non-empty → exit 1. Else exit `vc`.
  7. Always delete the scratch directory (`finally`).

Edge cases and failures:
  - A test file that throws at import → no results with passed/failed → `notExecuted` → exit 1.
  - An empty test file → JSON shows it with no assertions (or a failed suite with none) → `notExecuted` → exit 1.
  - A file with only `test.skip`/`test.todo` → `allSkipped` → exit 1 (a deliberate skip is removed, not committed).
  - One `test.skip`, `test.todo` or a `skipIf` that skipped, in a file whose other cases pass → `skippedCases` → exit 1.
    A test that needs a condition (a slow integration test) lives in a Vitest project that CI runs where the condition
    holds, never behind a skip.
  - A `*.spec.ts` outside `tests/e2e/`, or a `x.test.js` → `stray` → exit 1 (neither list would have seen it).
  - Tests under `deployment/` or `docs/` (later steps put tests there, e.g. `deployment/compose.test.ts`,
    `docs/human/compliance/ropa.test.ts`) → discovered and included like any other.
  - A test file under `scripts/guards/fixtures/` → skipped by both lists (fixtures use the `.fixture` suffix anyway).
  - Vitest exits 0 but a list is non-empty → exit 1 (the guard wins over Vitest's exit code).
  - Vitest crashes mid-run (OOM) → JSON missing → exit 1.
  - TypeScript 7 rejects a `tsconfig.json` option → fix it in this PR (TS 7 removed `baseUrl`, `moduleResolution:
    node10`, `esModuleInterop: false`, `target: es5`; the bootstrap uses none of them).
  - A dev tool needs the TypeScript ≤ 6 compiler API → `typescript_single_major` fails; the PR names the tool and the
    step that replaces or reconfigures it (dependency-cruiser is the known case, handled in P0.05).
  - A dependency needs its install script (`ignore-scripts=true`) → run `npm rebuild <pkg>` as a named step and list it
    in the PR; never turn scripts back on globally.

Done when (tests): (`scripts/test/run.test.ts`; pure parts with in-memory inputs, two end-to-end cases with real Vitest
in a temp directory)
  - compare_all_good: glob = listed = executed = {a, b} → all three lists empty.
  - compare_not_listed: glob {a, b}, listed {a} → `notListed = [b]`.
  - compare_import_error: listed {a, b}, report has results for a only → `notExecuted = [b]`.
  - compare_empty_file: report entry for c with 0 passed, 0 failed, 0 skipped → `notExecuted = [c]`.
  - compare_all_skipped: report file c with 2 skipped (one `todo`, one `skipped`) → `allSkipped = [c]`.
  - discover_includes_deploy_and_docs: fixture with `deployment/a.test.ts`, `docs/b.test.ts`, `node_modules/c.test.ts`,
    `scripts/guards/fixtures/d.test.ts` → `[deployment/a.test.ts, docs/b.test.ts]`; with an include list that omits
    `deploy` → `notListed = [deployment/a.test.ts]`. (Replaces bootstrap `guards.test.ts:86-95`, which encoded the old
    five-directory rule.)
  - list_uses_files_only: the child-process argument vector for step 2 contains `list`, `--filesOnly`, `--json`.
  - end_to_end_planted_empty_file: temp repo with one real test and an empty `x.test.ts`, real Vitest → `main` returns 1
    and prints `x.test.ts` under "notExecuted" (≤ 20 s).
  - only_is_rejected: temp repo with `test.only(...)` → `main` returns 1.
  - compare_skipped_case_in_passing_file: report file c with 3 passed and 1 `todo` → `skippedCases = ["c > <name>"]`;
    end to end with real Vitest, a file with one passing test and one `test.skip` → `main` returns 1.
  - stray_test_files: fixture with `apps/web/a.spec.ts`, `domains/x/b.test.js`, `tests/e2e/c.spec.ts` → `stray =
    [apps/web/a.spec.ts, domains/x/b.test.js]`.
  - retry_zero: `vitest.config.ts` sets `test.retry = 0`.
  - typecheck_includes_tests: temp repo with a type error only inside `a.test.ts` → `npm run typecheck` exits ≠ 0.
  - typescript_single_major: `npm ls typescript --all --json` → every resolved `typescript` version starts with `7.0.`;
    `npm ci` output in CI shows no peer-range conflict.
  - npmrc_lines: `.npmrc` contains `ignore-scripts=true` and `@unset:registry=https://127.0.0.1:9/`.
  - guards_ported: the bootstrap guard tests (`guards.test.ts:24-75`) run under Vitest and pass.
  - ci_on_node_26: the PR's `check` job runs on the `.nvmrc` version and passes.

Reuse: bootstrap `scripts/guards/run-tests.ts:25-58` and `file-reporter.ts` → LESSON (same idea for `node:test`).
Bootstrap `guards.test.ts` → SALVAGE (swap `node:test`/`node:assert` for Vitest; keep cases except lines 86-95).
`vitest`, `vite`, `typescript` → USE (plan §7, decision 16; pins at PR time). Provisional — for reuse review.
Not in this step: workspace packages and `test.projects` (P1.01); Biome CSS and dependency-cruiser (P0.05); new guards
(P0.06); Playwright (P1.26).
Diagram: none.

---

### P0.05 — Lint stack: Biome CSS rules, dependency-cruiser on the swc parser, file-size and line-budget warnings
Tags: —            Depends on: P0.04            Plan: §7 tooling, §9 "Measured", §4 (budgets), §6.1 CSS budget; PI-3
Where: `biome.json`; new `.dependency-cruiser.cjs`; new `scripts/budgets/budgets.json`, `scripts/budgets/check.ts`,
  `scripts/budgets/check.test.ts`, `scripts/lint/depcruise.test.ts`, `scripts/lint/fake-boot.test.ts` (with fixtures);
  `package.json` scripts `lint`, `budgets`
Size: ~150 source lines, ~220 test lines

Goal: lint covers TypeScript and CSS in one tool, module boundaries are enforced from day one by the boundary tool the
plan names, with a test that fails if that tool silently scans nothing, and size growth shows on every PR as a warning.

**As built (merged as PR #9; deviations recorded, editor pass 2026-10-04 evening):**
  - Root files count as tooling only when they are config (`*.config.*`, `.dependency-cruiser.cjs` and the like);
    any other root `.ts` file is product code to the boundary rules.
  - Biome `noConsole` is off for `scripts/**` (tooling prints to the terminal); it stays on everywhere else.
  - `.mts` and `.cts` files are refused (one module flavour; the swc parse and the matrix see `.ts`/`.tsx` only).
  - The Biome tests live in `scripts/lint/biome.test.ts` (beside `depcruise.test.ts`).
  - Two checks moved to the Semgrep custom-rules step, each with a planted fixture and failing closed: computed
    `import()`/`require()` (a non-literal specifier, which dependency-cruiser cannot follow) and `noFloatingPromises`
    (type-aware, not run by Biome on TypeScript 7 sources). the step is **P1.01s**
    (added 2026-10-04 late); P1.11 adds the DM-2 transactions rule to the same folder.

Inputs: P0.04 merged; plan §4 table for budgets.
Outputs:
  - `biome.json`: keep the bootstrap JS rules; add `css: { linter: { enabled: true }, formatter: { enabled: true } }`;
    CSS rules at **error**: `noHexColors`, `noMissingVarFunction`, `noImportantStyles` (`noUndeclaredCustomProperties`
    stays off until P1.21, see edge cases); `noExcessiveLinesPerFile` at **warn** with `maxLines: 300`,
    `skipBlankLines: true` for TS/TSX (README readability rule 3: "a file stays under about 300 lines"). An `overrides`
    entry for `shared/ui/src/tokens.css` (generated in P1.21) turns `noHexColors` off for that file only.
    `noExcessiveCognitiveComplexity` at **warn** with Biome's default threshold (README readable-code rule 3; decision
    35 D1, rule DC-1).
  - **Biome rule names confirmed (findings F-19).** Every Biome rule the engineering rules name with *(unverified)*
    is looked up in the pinned Biome's `configuration_schema.json` before it is switched on: `noExcessiveCognitiveComplexity`
    (DC-1, warn), `useConst` and `noParameterAssign` (DC-3), `noEmptyBlockStatements` and `noFloatingPromises` (DC-4),
    `noConsole` (SE-7, with an override for the logger file), `noFocusedTests` and `noSkippedTests` (TE-4). Found and
    stable → on, at error unless the rule says warn. Missing, renamed, nursery-only, or (for `noFloatingPromises`)
    type-aware and not running on TypeScript 7 sources → not switched on; the rule's stated fallback (a Semgrep rule)
    is recorded in the PR as owed by P1.01s (Semgrep custom rules), never a silent gap. Each rule switched
    on gets a known-bad fixture.
  - dependency-cruiser on TypeScript 7: dependency-cruiser 18.5 accepts the `typescript` package only `<7.0.0`
    (`src/meta.cjs:14`), and TS 7 no longer exports the compiler API it calls. It also supports `@swc/core`
    (`>=1.0.0 <2.0.0`, `meta.cjs:13`) and treats `.ts`/`.tsx` as scannable whenever swc is installed
    (`src/extract/transpile/meta.mjs`, `EXTENSIONS_PER_PARSER.swc`). So: add `dependency-cruiser` and `@swc/core` as
    exact devDependencies and set `options.parser = "swc"`. The option is marked experimental in its types
    (`types/options.d.mts:298`); the cruised-count test below is what makes that safe. Do not set `options.tsConfig`
    (reading it uses the TypeScript API); workspace imports resolve through the `node_modules` links.
  - `.dependency-cruiser.cjs`: `options: { parser: "swc", doNotFollow: { path: "node_modules" }, exclude: { path:
    "(^|/)(dist|coverage|\\.worktrees|graphify-out|scripts/guards/fixtures)/" } }`, and rules, all `severity: "error"`,
    each with a `comment` citing the plan section:
      **Allowlist matrix (rule AB-1; plan §7 "any edge not listed fails"; bibliography review R1-01).** The config's
      `allowed` array, built from one constant `MATRIX`, is the definition of the boundaries, with `allowedSeverity:
      "error"`: an edge that no row matches is reported as `not-in-allowed` and fails the lint. The named `forbidden`
      rules below stay so that a failure names the boundary it breaks; they are fixtures of the matrix, not its
      definition. Rows (a new edge is a new row plus its fixture, in the same PR):
      - `apps/<x>/**` → its own folder, `shared/**`, npm packages (vendor SDKs only as `SDK_ADAPTERS` says);
      - `interfaces/<x>/**` → its own folder, `domains/**`, `infrastructure/**`, `shared/**`, `node:*`, npm packages;
        `interfaces/http/**` → `apps/web/<render entry>`; `interfaces/admin/**` → `apps/admin/<render entry>`;
      - `interfaces/{pds-admin,chat-admin}/**` (instead of the row above) → their own folder, `node:*`, `ZERO_DEP_ALLOWLIST`;
      - `domains/<x>/**` → its own folder (its contracts), `domains/<y>/index.ts`, `shared/errors/**`, `shared/config/**`
        as **type-only** imports, `shared/lexicons/**` (the one record validator, called on the write path), and `node:*`
        except the I/O built-ins of `domain-no-io-builtins`. No npm package: `@atproto/lex` is reached only through
        `shared/lexicons/`, the single npm exception (AB-1 as settled by the architecture thread, 2026-10-04);
      - `infrastructure/<x>/**` → its own folder, `domains/**`, `shared/**`, `infrastructure/net-guard/**`,
        `infrastructure/seal/**`, `node:*`, npm packages (vendor SDKs as `SDK_ADAPTERS` says);
        `infrastructure/net-guard/**` → its own folder, `node:*`, `undici` only;
      - `shared/<x>/**` → `shared/**`, `node:*`, npm packages; `shared/ui/**` and `shared/lexicons/**` → their own folder
        and npm packages only; `shared/admin-envelope/**` → its own folder and `node:*` only;
      - `scripts/**`, `tests/**` and `**/*.test.ts` → any edge the `forbidden` rules allow.
      The first PR's swc check (algorithm step 2) also confirms that swc reports `import type` as dependency type
      `type-only` and `import()` as `dynamic`. If it does not, the `shared/config` row narrows to one types-only file
      (`shared/config/types.ts`), `fake-only-in-composition-root` keeps only its path part, and both are recorded in
      the reconciliation ADR.
      Boundary rules (decision 34; guideline §1–§2, plan §7):
      `no-app-to-app` — `apps/X` imports nothing from `apps/Y`.
      `app-only-shared` — among repository folders, `apps/<x>/**` imports only its own folder and `shared/**` (guideline §1:
        never another app, `domains/`, `interfaces/` or `infrastructure/`). Islands reach the server over HTTP only.
      `app-render-entry-only` — the only imports of an app from outside it are `interfaces/http/**` → `apps/web/<render
        entry>` and `interfaces/admin/**` → `apps/admin/<render entry>` (server-side rendering; data passed as props). The
        render entry paths are named in the rule; P1.20 fixes them.
      `no-interface-to-interface` — `interfaces/<x>/**` imports nothing from `interfaces/<y>/**` (each is its own process;
        code two interfaces need goes to `shared/` or a domain; guideline §1, O-2 resolved 2026-10-04 05:10Z).
      `domain-pure` — `domains/**` imports nothing from `infrastructure/**`, `interfaces/**` or `apps/**`.
      `domain-cross-via-index` — a file in `domains/<x>/**` imports another domain only through `domains/<y>/index.ts`
        (README readable-code rule 3: a workspace exports only through one `index.ts`; findings F-17).
      `domain-no-io-builtins` — `domains/**` imports none of `node:fs`, `node:fs/promises`, `node:net`, `node:http`,
        `node:https`, `node:http2`, `node:dgram`, `node:dns`, `node:tls`, `node:child_process`, `node:worker_threads`
        (functional core, README rule 1: I/O arrives as a passed-in dependency).
      `no-product-imports-tooling` — nothing outside `scripts/**` and `tests/**` imports `scripts/**` or `tests/**`
        (invariant 13: `scripts/` is tooling product code never imports; a denylist would let a new folder through).
      `infrastructure-not-entry` — `infrastructure/**` imports nothing from `interfaces/**` or `apps/**` (it implements
        contracts that `domains/` define, so `infrastructure → domains` is allowed).
      `shared-leaf` — `shared/**` imports nothing from `apps/**`, `interfaces/**`, `domains/**` or `infrastructure/**`
        (replaces the old `no-package-to-app`).
      `admin-services-zero-deps` — `interfaces/pds-admin/**` and `interfaces/chat-admin/**` each import only `node:*`, files
        inside their own folder, and folders on the zero-dependency allowlist `ZERO_DEP_ALLOWLIST` (a constant in the config;
        today exactly `shared/admin-envelope/`, P3.16). `allowlist-zero-deps` — an allowlisted folder obeys the same rule
        (only `node:*` and its own files), so nothing reaches these services transitively. Adding an entry needs Alex's
        approval in the PR (§5.2; guideline §1; O-1/O-5 resolved). Whether P2.14's `verify.ts` joins the list is P6.00's
        decision; there are no byte-equal copies.
      `vendor-sdk-one-adapter` — each vendor SDK is imported in exactly one adapter folder per runtime, named in the rule's
        table `SDK_ADAPTERS` (guideline §1, O-7 resolved): `pg` → `infrastructure/postgres/`; `undici` →
        `infrastructure/net-guard/`; `@atproto/oauth-client-node`, `@atproto/api` → `infrastructure/pds/`; the S3 client →
        `infrastructure/storage/`; `age-encryption` → `infrastructure/seal/`; `@atproto/lex*` → `shared/lexicons/`
        (generated code); `matrix-js-sdk` → `apps/chat/matrix/` (browser runtime, Phase 6). Each later SDK is added to the
        table by the step that introduces it; an SDK not in the table may not be imported anywhere.
      (No plugin boundary or registry rule: decision 25 defers the plugin boundary lint, the registry and
        `plugin-api` to the first real plugin, whose PR adds them; there is no `plugins/` folder until then.)
      `net-guard-leaf` — `infrastructure/net-guard/**` imports only `node:*`, `undici` and its own files.
      `web-not-admin` — `apps/web/**` and `interfaces/http/**` import nothing from `apps/admin/**`,
        `interfaces/admin/**` or any `**/admin/**` path (§5.7).
      `fake-only-in-composition-root` — a `*.fake.ts` file is imported only from `**/*.test.ts`, `tests/**` and
        `interfaces/*/compose.ts`, and from `compose.ts` only by a dynamic `import()` (`to: { dynamic: true }`) placed
        in the branch that has already checked `UNSET_ENV != "prod"` (rule TE-1 as settled 2026-10-04; decision 23 runs
        the Arachnid fake on the closed-test host). `interfaces/<x>/main.ts` starts the process and calls its
        `compose.ts`; both are the composition root (AB-2), and only `compose.ts` may reach a fake. A fake never sits in
        `domains/` (it doubles an unmanaged dependency, so it lives beside that dependency's adapter).
      `no-circular` — no cycles.
      `no-orphans` at warn.
  - `scripts/budgets/budgets.json`: `{ "<path or glob>": maxLines | { "max": maxLines, "reason": "<one line>" } }` from
    §4, as warnings (a raised number carries a reason; the check prints the reason beside any notice, and a number
    above the plan §4 default with no reason prints a `::warning` naming the entry, never a failure): the former core
    (`domains/**`, `infrastructure/**` except `net-guard` and `audit`, `shared/{config,errors,i18n,log,http,admin-envelope}`) 9000 combined,
    `apps/web` + `interfaces/http` 7000 combined, `interfaces/api` 1200, `interfaces/indexer` 1500, `interfaces/media` 600,
    `interfaces/review` 2500, `apps/admin` + `interfaces/admin` + `interfaces/pds-admin` + `infrastructure/audit`
    **3000 combined** (decision 15), `infrastructure/net-guard` 400, `shared/ui` 2500. Numbers are the upper end of §4
    rows mapped onto the decision-34 folders.
  - `scripts/budgets/check.ts`: `countLines(source): int` (non-blank lines that are not only a comment); `check(root,
    budgets): Warning[]` over `.ts`/`.tsx`, excluding `*.test.*`, `*.fake.ts`, `*.generated.*` and `SKIP_DIRS` (a fake
    is a test double, not module code; architecture ruling 2026-10-04 23:53Z); `main` prints
    `::warning title=line-budget::<package> <n>/<max>` per overrun and a table to `$GITHUB_STEP_SUMMARY` when set;
    **always exits 0** (decision 15: budgets warn, never gate).
  - `package.json`: `"lint": "biome ci . && depcruise --config .dependency-cruiser.cjs ."`, `"budgets": "node
    scripts/budgets/check.ts"`.

Algorithm:
  First PR (the swc check, done before the rules are written):
  1. Install `dependency-cruiser` and `@swc/core` (exact). Create a temp fixture with `a.ts` importing `./b.ts`.
  2. Run `depcruise --config <minimal config with parser swc> --output-type json <fixture>`.
     a. Exit 0 and `summary.totalCruised = 2` and one dependency `a.ts → b.ts` → continue.
     b. Anything else → stop. Record the output in the reconciliation ADR and ask (options: wait for a dependency-cruiser release that
        supports TS 7; a small import-boundary guard in `scripts/guards/` reusing `files.ts`). Do not write the rules
        against a parser that does not work.
  3. Write the rules, the budget files and the tests; run `npm run lint`.
  `budgets check`:
  1. Read `budgets.json`; parse error → print it with `::warning` and exit 0 (never block on the budget file).
  2. For each key: a path that does not exist yet → count 0 (packages appear in P1.01).
  3. Sum `countLines` over matching files; the combined admin key sums its three paths.
  4. `sum > max` → warning; `sum > 0.9 × max` → notice. Print the table. Exit 0.

Edge cases and failures:
  - `noUndeclaredCustomProperties` cannot see custom properties declared in another file → off here; P1.21 decides with
    the token pipeline.
  - depcruise is given a directory that does not exist (no `apps/` yet) → the script cruises `.` with excludes, so it
    never names missing directories.
  - depcruise parses no file (a future version drops swc, or a broken `@swc/core` binary under `ignore-scripts`) →
    `depcruise_cruised_nonzero` fails; the rules can never pass on an empty graph.
  - A generated file over 300 lines → excluded from the budget by its `*.generated.*` suffix; for the Biome warning, an
    `overrides` entry for `**/*.generated.*` turns `noExcessiveLinesPerFile` off. Generated code must use that suffix.
  - Budget overrun → warning only.
  - An import between two folders that no `MATRIX` row lists and no `forbidden` rule names (for example a domain
    importing `shared/http/`) → `not-in-allowed`, exit ≠ 0. The matrix fails closed; nothing is allowed by omission.
  - A production boot whose config asks for a fake → `compose.ts` refuses before the `import()` is reached (exit 1,
    `config.fake_in_prod`); a fake module is never evaluated in production.

Done when (tests): (`scripts/budgets/check.test.ts`, `scripts/lint/depcruise.test.ts`, `scripts/lint/fake-boot.test.ts`;
  fixtures in temp directories)
  - count_skips_comments_and_blanks: 3 code lines, 2 comment lines, 2 blank → 3.
  - count_excludes_tests_and_generated: `a.test.ts`, `x.generated.ts` → 0.
  - budget_reason_field: an entry with a reason parses and its notice shows the reason; an entry above the plan §4
    default with no reason prints a `::warning` naming the entry; exit 0 (decision 15). Budgets prompt a reviewer to
    look and are never a target: a module may grow past its budget when splitting would hurt readability, with the
    reason recorded next to the raised number (Alex via architecture, 2026-10-05).
  - budgets_skip_fakes: a package with 50 lines of `x.ts` and 500 lines of `x.fake.ts` against a budget of 100 → no
    warning.
  - budget_overrun_warns_not_fails: fixture package of 12 lines, max 10 → one `::warning` line, exit 0.
  - combined_admin_budget: lines in `apps/admin` + `interfaces/admin` + `interfaces/pds-admin` + `infrastructure/audit`
    summed against 3000.
  - biome_rejects_hex_in_css: fixture `apps/web/x.module.css` with `color: #fff` → `biome ci` on it exits ≠ 0.
  - biome_allows_hex_in_tokens: fixture `shared/ui/src/tokens.css` with `--c: #fff` → exits 0.
  - biome_rule_names_exist: every rule key in `biome.json` exists in the pinned Biome's `configuration_schema.json`
    (an invented name fails).
  - biome_cognitive_complexity_warns: fixture function with deeply nested branches → a warning, exit 0.
  - biome_rules_bite: one known-bad fixture per rule switched on from the F-19 list → `biome ci` exits ≠ 0 (warn-level
    rules: a warning line).
  - depcruise_cruised_nonzero: `depcruise --output-type json` on a 2-file fixture → `summary.totalCruised = 2`; on the
    real tree → `totalCruised ≥ 1` once any `.ts` file exists outside the excludes (it does: `scripts/`).
  - depcruise_app_to_app: fixture `apps/web/a.ts` importing `../../apps/admin/b.ts` → exit ≠ 0 naming `web-not-admin`
    or `no-app-to-app`.
  - depcruise_pds_admin_builtins: fixture `interfaces/pds-admin/a.ts` importing `undici` → exit ≠ 0; importing
    `../../shared/config/x.ts` → exit ≠ 0; importing `../../shared/admin-envelope/jcs.ts` → exit 0 (allowlisted); the
    same three fixtures under `interfaces/chat-admin/` → the same results.
  - depcruise_allowlist_zero_deps: fixture `shared/admin-envelope/a.ts` importing `../config/x.ts` or `undici` → exit ≠ 0
    naming `allowlist-zero-deps`.
  - depcruise_allowlist_exact: the config's `ZERO_DEP_ALLOWLIST` equals `["shared/admin-envelope/"]` (a change fails this
    test and so shows in review).
  - depcruise_no_interface_to_interface: fixture `interfaces/api/a.ts` importing `../http/b.ts` → exit ≠ 0 naming
    `no-interface-to-interface`.
  - depcruise_app_render_entry: fixture `interfaces/api/a.ts` importing `../../apps/web/render.tsx` → exit ≠ 0;
    `interfaces/http/a.ts` importing the named web render entry → exit 0; importing any other `apps/web` file → exit ≠ 0.
  - depcruise_sdk_adapter: fixture `infrastructure/storage/a.ts` importing `pg` → exit ≠ 0; `apps/web/a.ts` importing
    `matrix-js-sdk` → exit ≠ 0; `apps/chat/matrix/a.ts` importing `matrix-js-sdk` → exit 0.
  - One fixture per forbidden edge, each → exit ≠ 0 naming its rule: `apps/web/a.ts` importing
    `../../infrastructure/postgres/b.ts` and `../../domains/identity/b.ts` (`app-only-shared`); `domains/identity/a.ts` importing
    `../../infrastructure/pds/b.ts`, `../../interfaces/http/b.ts` and `../../apps/web/b.ts` (three files,
    `domain-pure`); `infrastructure/pds/a.ts` importing `../../interfaces/http/b.ts` (`infrastructure-not-entry`);
    `shared/config/a.ts` importing `../../domains/identity/b.ts` (`shared-leaf`); `domains/identity/a.ts` importing
    `pg` (`vendor-sdk-one-adapter`); `interfaces/http/a.ts` importing `../../apps/admin/b.ts` (`web-not-admin`);
    `domains/content/a.ts` importing `../identity/sessions/b.ts` (`domain-cross-via-index`; importing
    `../identity/index.ts` → exit 0); `domains/identity/a.ts` importing `node:fs` (`domain-no-io-builtins`; `node:crypto`
    → exit 0); `domains/identity/a.ts` and `interfaces/http/a.ts` importing `../../scripts/guards/files.ts`
    (`no-product-imports-tooling`; `tests/integration/a.test.ts` importing it → exit 0).
  - depcruise_allowed_edges: `interfaces/http/a.ts` → `../../domains/identity/b.ts`, `infrastructure/pds/a.ts` →
    `../../domains/identity/contract.ts`, `apps/web/a.ts` → `../../shared/ui/b.ts`, `interfaces/admin/a.ts` →
    `../../shared/http/b.ts`, `infrastructure/postgres/a.ts` →
    `pg` → exit 0 (each is a row of `MATRIX`).
  - depcruise_unlisted_edge_fails (R1-01): edges named by no `forbidden` rule and listed in no `MATRIX` row →
    exit ≠ 0 with `not-in-allowed`: `domains/identity/a.ts` importing `../../shared/http/b.ts`;
    `infrastructure/storage/a.ts` importing `../audit/b.ts`; `shared/ui/a.ts` importing `../config/b.ts`. A config
    whose `allowedSeverity` is not `error`, or with no `allowed` array, fails this test.
  - depcruise_matrix_rows_have_fixtures: every `MATRIX` row has at least one passing fixture edge in this file (a row
    added without one fails; rule AB-1 "one fixture per matrix row").
  - depcruise_domain_imports (AB-1 domain row): from `domains/identity/a.ts`, `../../shared/errors/b.ts`,
    `../../shared/lexicons/b.ts`, `../content/index.ts`, `node:crypto` and `import type` from `../../shared/config/b.ts`
    → exit 0; a value import from `../../shared/config/b.ts`, `../../shared/log/b.ts`, the npm packages `zod` and
    `@atproto/lex` → exit ≠ 0.
  - depcruise_fake_only_in_composition_root (TE-1): `interfaces/http/compose.ts` with `await import(
    "../../infrastructure/arachnid/fingerprint-check.fake.ts")` → exit 0; the same as a static `import` → exit ≠ 0;
    `interfaces/http/routes/a.ts`, `interfaces/http/main.ts`, `infrastructure/arachnid/arachnid-check.ts` and
    `domains/moderation/a.ts` importing it → exit ≠ 0; `infrastructure/arachnid/fingerprint-check.test.ts` and
    `tests/integration/a.test.ts` importing it → exit 0.
  - fake_files_outside_domains: a scan finds no `*.fake.ts` under `domains/`; a fixture `domains/x/y.fake.ts` fails it.
  - fake_boot_refused_in_prod (startup test, TE-1 "production refuses to start with one wired"): for every
    `interfaces/*/compose.ts` that mentions a `*.fake.ts`, plus a fixture composition root, start it in a child
    process with `UNSET_ENV=prod` and the config that selects each fake, under a Node module-resolve hook that records
    every resolved URL → exit ≠ 0 with `config.fake_in_prod` and no `*.fake.ts` URL recorded; with `UNSET_ENV=dev` the
    fixture loads its fake (the test proves it examined more than zero composition roots: the fixture counts).
  - lint_clean_repo: `npm run lint` on the real tree exits 0.

Reuse: Biome 2.5.15 → USE (bootstrap pin; `noExcessiveLinesPerFile` with `maxLines`/`skipBlankLines` exists in its
schema). dependency-cruiser + `@swc/core` → USE (plan §7 names dependency-cruiser; swc is its own supported parser;
both MIT/Apache-2.0, exact pins). A home-grown boundary guard → REJECT unless step 2b happens (addendum §5: use the
established tool). Stylelint → REJECT (plan §7). Provisional — for reuse review.
Not in this step: the GritQL token plugin, `useLayeredStyles`, CSS size budget (P1.21); workspace `tsconfig` references
(P1.01); repo guards (P0.06).
Diagram: none.

---

### P0.06 — Repo guards as Vitest tests, each with a planted failing fixture
Tags: [SEC]            Depends on: P0.05            Plan: §2 rules 13, 14, 15; §5.2 (cookies); §5.7 (no moderator route in `web`)
Where: `scripts/guards/` — keep `files.ts`, `egress.ts`, `cookie-domain.ts`; new `inner-html.ts`, `web-no-moderator.ts`,
  `ip-columns.ts`, `ip-columns.allow.json`, `repo.test.ts`, `fixtures/<rule>/{bad,good}/*.fixture`; edit `guards.test.ts`; `package.json` `guards` script;
  `.githooks/pre-commit`
Size: ~220 source lines, ~260 test lines

Goal: five repository rules are enforced by tests that scan the real tree on every run, and each rule has a fixture
proving it still catches what it is meant to catch.

Inputs: bootstrap guards (`egress.ts`, `cookie-domain.ts`, `files.ts`), Vitest (P0.04), `SKIP_DIRS` (P0.04).
Outputs: guard modules, each exporting `scan<Rule>(file: string, source: string): Finding[]` and `SCANNED_DIRS`
  (decision 34: `apps/`, `interfaces/`, `domains/`, `infrastructure/`, `shared/`, `deployment/`, `tests/`; the egress
  rule exempts `infrastructure/net-guard/`);
  `Finding = { file, line, rule, text }` (bootstrap `files.ts:33`); `report(findings)` prints one line per finding in the
  bootstrap format `file:line  [rule]  text` (`files.ts:41`), which P0.14 reads from the CI log.
  Rules:
  - `egress` (bootstrap `egress.ts:11-25`, extended): flag
    (a) `fetch(` whose first argument is not a plain string literal on the same line;
    (b) a raw client module named in `from "…"`, `require("…")`, `import("…")` or `import x = require("…")`, where the
        module matches `^(node:)?(https?|http2|net|tls|dgram)$` or `^(undici|axios|got|node-fetch|ws)(/.*)?$`;
    (c) `\bnew\s+(WebSocket|EventSource)\s*\(` (both are globals in Node 26).
    Exempt: files under `infrastructure/net-guard/`, and test files. A line annotated `// guard-allow: egress <reason>` is
    exempt only when `<reason>` is non-empty. One **file** exemption, fixed in the module as
    `EGRESS_FILE_EXEMPTIONS = ["interfaces/pds-admin/pds.mjs"]`: P2.09's `pds-admin` makes `node:http` calls to the one
    internal origin `PDS_INTERNAL_URL` from that file only (phase-2 E10). The list has exactly that entry; adding
    another is a change to this step.
  - `cookie-domain` (bootstrap `cookie-domain.ts:10-32`): `; Domain=` in a cookie string, or a `domain:` option within 5
    lines of cookie code. **No** `guard-allow` for this rule: remove the bootstrap's `allowed()` call (a `Domain=` cookie
    is never acceptable, plan §5.2).
  - `inner-html` (new): `dangerouslySetInnerHTML`, `.innerHTML =`, `.outerHTML =`, `insertAdjacentHTML(`,
    `document.write(`, `setHTMLUnsafe(` and `Document.parseHTMLUnsafe(` (the last two added in PR #10/#11, approved by
    Alex; editor pass 2026-10-04 evening) anywhere in `apps|interfaces|domains|infrastructure|shared`, tests included. **Zero exemptions**: P2.20 renders
    profile markdown to React elements, so no file needs raw HTML. No `guard-allow`. This guard is the single mechanism
    for raw HTML (it covers more than Biome's `noDangerouslySetInnerHtml`, which P1.24 therefore does not add; see Notes).
  - `web-no-moderator` (new): inside `apps/web/**` and `interfaces/http/**` only, flag (a) a string literal path matching
    `^/(admin|mod|moderat\w*|staff|ops|internal)(/|$)`; (b) imports from `apps/admin`, `interfaces/admin`,
    `@unset/admin`, `@simplewebauthn/*`;
    (c) a string literal naming a `pds-admin` verb other than `invite.issue`, i.e. matching
    `^(takedown|reinstate|account\.\w+|handle\.rename|hold\.\w+|preserve\.\w+|pds\.health|signup\.(open|close)|limits\.raise|lookup\.\w+|pii\.\w+)$`
    (`hold.*` are the delete-hold verbs of P3.16a, `preserve.*` the legal-hold verbs of P3.16c, `account.*` and
    `pds.health` P3.16d rows). No `guard-allow`. (Report intake at `/report` is a user route and does not match.)
  - `ip-columns` (new; the "no IP written" check that P3.17 (AD §8.1) and P4.03/P4.07 cite): scans SQL migrations
    (`**/migrations/**/*.sql`, outside `SKIP_DIRS`) and flags (a) a column declared with type `inet`, `cidr` or
    `macaddr`; (b) a column whose name matches
    `(^|_)(ip|ipv4|ipv6|ip_addr|ip_address|remote_addr|client_addr|client_ip|user_agent|ua)($|_)` whatever its type
    (global invariant 3). Exempt only tables listed in `scripts/guards/ip-columns.allow.json`
    (`[{ "table": "<schema>.<table>", "step": "<step id>", "reason": "<non-empty>" }]`), which **starts empty**. The
    steps that own the exception add their own entry in their own PR: the transmission buffer and the held copy
    (P4.03 / P4.07, image entry point P5.07b; decision 21); staff tailnet addresses (P3.17 `adm.session`) only after the
    README exception asked for in phase-3 Notes is approved. The file sits under `/scripts/guards/`, a CODEOWNERS
    security path (P0.03). No `guard-allow`. The rule is lexical on schema only; log lines are checked at run time by
    each step's `no-ip-in-logs` style tests, and the edge drops client addresses before they reach any app (P1.28).
  - `repo.test.ts`: for each rule, `scanAll(repo root)` → expect `[]`; on failure the message is `report(findings)`.
  - `package.json`: `"guards": "vitest run scripts/guards"`. `.githooks/pre-commit` keeps calling `npm run --silent guards`.

Algorithm (each scanner, shared shape):
  1. `files = sourceFiles(root, SCANNED_DIRS)` (sorted; `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`; skips
     `SKIP_DIRS`).
  2. For each file: apply the rule's path filter (net-guard, tests and `EGRESS_FILE_EXEMPTIONS` for `egress`;
     `apps/web/` and `interfaces/http/` prefixes for `web-no-moderator`; `ip-columns` reads `.sql` files under `migrations/` instead of source
     files). Filtered out → skip.
  3. Read the file as UTF-8 with `fatal: true`. Read or decode error → a finding `{rule, text: "unreadable"}` (fail
     closed: a guard never skips a file it could not read).
  4. Split into lines; apply the rule's patterns; a match → a finding, unless the rule allows `guard-allow` and the line
     carries `guard-allow: <rule> <non-empty reason>`. For `ip-columns`, the table a column belongs to is the nearest
     preceding `CREATE TABLE` / `ALTER TABLE` name; a finding is dropped only when that table is in the allow file. An
     allow-file entry with an empty `reason` or an unknown step id, or that matches no table in any migration → a
     finding (stale or unexplained exemptions fail).
  5. Return findings sorted by file, then line.
  Fixture tests: copy `fixtures/<rule>/bad/*.fixture` into a temp repo at the path named in the fixture's first comment
  line, with a `.ts`/`.tsx` name (the `.fixture` suffix keeps them out of the real scan, typecheck and Biome); run the
  scanner → expect the stated number of findings per file; the same for `good/` → expect 0.

Edge cases and failures:
  - `fetch` split over two lines (`fetch(\n url)`) → nothing constant after `fetch(` on the line → finding (fail closed).
  - `guard-allow: egress` with no reason → still a finding.
  - Dynamic `import(variable)` → not a literal module name; not flagged by (b); the egress risk is then `fetch` or a
    client call, which (a)/(c) see. Accepted limit of a lexical guard; dependency-cruiser's `net-guard-leaf` and code
    review cover the rest.
  - A moderator verb in a comment in `apps/web` or `interfaces/http` → still a finding (the rule is lexical; reword the comment).
  - A non-UTF-8 file with a source extension → decode error → finding.
  - `ip-columns`: a column added later by `ALTER TABLE … ADD COLUMN client_ip text` → caught by (b); an address hidden
    inside a JSONB or sealed column → not detectable lexically; the sealed exception is covered by P4.03's tests, and
    P1.15's `p_pii` check limits audit PII to tailnet addresses.
  - A second file in `interfaces/pds-admin` importing `node:http` → finding (only `pds.mjs` is exempt).

Threats: source code entering `main`, scanned on every run.
  - I A caller-influenced outbound request bypasses `net-guard` (SSRF) → `egress` rule (`egress_bad_fixture`,
    `egress_bad_fixture_raw_sockets`, `egress_allow_needs_reason`).
  - I A cookie scoped to a parent domain is readable from a member's `*.0x40.me` page → `cookie-domain` rule
    (`cookie_bad_fixture`).
  - T Injected markup through a raw HTML sink (XSS) → `inner-html` rule with an empty exemption list
    (`inner_html_bad_fixture`, `inner_html_exemption_list_empty`).
  - E A moderator route or `pds-admin` verb reachable from `web` → `web-no-moderator` rule
    (`web_moderator_bad_fixture`, `web_moderator_preserve_verb`).
  - I An address or user-agent column is written (invariant 3) → `ip-columns` rule with a reasoned allow-list that
    starts empty (`ip_columns_bad_fixture`, `ip_columns_allow_starts_empty`).
  - T A guard silently scans nothing → a planted bad fixture per rule; an unreadable file is a finding
    (`unreadable_file_is_finding`, `repo_clean`).

Done when (tests):
  - egress_bad_fixture: `fetch(url)`, a template-literal URL, `base + path`, `import { request } from "undici"` → 4.
  - egress_bad_fixture_raw_sockets: one line each of `import http2 from "node:http2"`, `import net from "net"`,
    `require("node:tls")`, `require("axios")`, `await import("undici")`, `import got = require("got")`,
    `new WebSocket(u)`, `new EventSource(u)`, `import { WebSocket } from "ws"` → 9 findings, one per line.
  - egress_good_fixture: `fetch("https://plc.directory/x")`; a line with `guard-allow: egress constant PDS URL`;
    `infrastructure/net-guard/index.ts` with `fetch(url)`; `import { readFile } from "node:fs"` → 0.
  - egress_allow_needs_reason: `fetch(u) // guard-allow: egress` → 1.
  - cookie_bad_fixture: `"a=b; Domain=x.y"` and a `domain:` option next to `setCookie` → 2; a line with
    `guard-allow: cookie-domain x` is still a finding.
  - cookie_good_fixture: `{ domain: env.HANDLE_DOMAIN }` far from cookie code; `"__Host-a=b; Path=/"` → 0.
  - inner_html_bad_fixture: `dangerouslySetInnerHTML` in `apps/web/src/profile/markdown.tsx`, `el.innerHTML = s` in
    `shared/ui/src/y.ts`, `insertAdjacentHTML(` in a `*.test.ts`, `el.setHTMLUnsafe(s)` and
    `Document.parseHTMLUnsafe(s)` → 5.
  - inner_html_exemption_list_empty: the module exports no exemption list (or an empty one) → asserted.
  - web_moderator_bad_fixture: `interfaces/http/routes/a.ts` with `"/admin/users"`, `import "@simplewebauthn/server"`,
    `"takedown"` → 3.
  - web_moderator_good_fixture: `"/report"`, `"invite.issue"` in `apps/web`; `"/admin"` in `apps/admin` → 0.
  - web_moderator_preserve_verb: `"preserve.create"` and `"account.lookup"` in `apps/web/src/x.ts` → 2.
  - egress_file_exemption_exact: `EGRESS_FILE_EXEMPTIONS` equals `["interfaces/pds-admin/pds.mjs"]`; a fixture
    `interfaces/pds-admin/pds.mjs` with `import http from "node:http"` → 0; the same line in `interfaces/pds-admin/other.mjs` → 1.
  - ip_columns_bad_fixture: a migration with `login_ip inet`, `user_agent text`, `ALTER TABLE app.t ADD COLUMN
    client_ip text`, `peer cidr` → 4.
  - ip_columns_good_fixture: `ship_date date`, `description text`, `zip text`, `sealed types.sealed` → 0.
  - ip_columns_allow_file: `app.t` listed with step and reason → its columns pass; an entry with an empty reason → 1;
    an entry naming a table no migration creates → 1.
  - ip_columns_allow_starts_empty: in Phase 0 `ip-columns.allow.json` is `[]`.
  - report_format: `report([{file:"a.ts", line: 3, rule:"egress", text:"fetch(u)"}])` → `a.ts:3  [egress]  fetch(u)`.
  - repo_clean: each rule over the real repository → 0.
  - unreadable_file_is_finding: a file with invalid UTF-8 bytes in a temp repo → 1 finding (no `chmod`, so it works as
    root in CI too).

Reuse: bootstrap `scripts/guards/egress.ts`, `cookie-domain.ts`, `files.ts`, `guards.test.ts` → SALVAGE (move tests to
Vitest; extend the egress client list; remove `guard-allow` for `cookie-domain`; require a reason on `guard-allow`).
Prototype `/home/claude/0x40/CLAUDE.md` "never add a fifth copy" rule → LESSON. Provisional — for reuse review.
Not in this step: exact-pin and lockfile guard (P0.08); CSRF static test (P1.07); `alsoKnownAs` reader guard (P2.01);
raw `getBlob` URL guard (P3.09); `fetch` uses inside net-guard itself (P1.18); the allow-file entries themselves
(P4.03, P4.07, P5.07b, Phase 3 `adm.*`).
Diagram: none.

---

### P0.07 — CI workflow: pinned images and actions, full gate set, secrets and OIDC bound to `main`
Tags: [SEC] [ALEX] (tail: required checks)            Depends on: P0.06            Plan: §8 Phase 0 ("CI from commit 1"), §6.1 (SAST/deps, SLSA), §9; README rule 10
Where: `.github/workflows/ci.yml` (rewrite); new `.github/required-checks.json`, `.gitleaks.toml`, `.semgrepignore`,
  `.jscpd.json`; new `scripts/guards/workflow-pins.test.ts`, `scripts/guards/secret-patterns.test.ts`
Size: ~180 lines of YAML/TOML/JSON, ~160 test lines

Goal: every PR runs typecheck, lint, guards, tests (discovered = executed), dependency audit and registry-signature
check with install scripts off, a full-history secret scan, workflow lint and Semgrep CE, and produces an SBOM and a
duplicate-code report; every action is GitHub-owned and SHA-pinned, every tool image is pinned by index digest, and no
workflow on a branch can reach a secret or mint an OIDC token.

Inputs: P0.06 merged; bootstrap `ci.yml:1-44`; P0.03 Actions settings (GitHub-owned actions only).

**As built (merged as PR #13; editor pass 2026-10-04 evening):**
  - gitleaks runs from `ghcr.io/gitleaks/gitleaks` pinned by index digest.
  - Algorithm step 5 (the planted faults) needs a scratch branch that Alex provides or approves.
  - The Alex tail (steps 8–9, required checks in the ruleset) is **deferred until protection exists** (decision 41,
    ADR 0009); `.github/required-checks.json` is still written and tested, so the list is ready the day the ruleset is
    applied (P0.03 step 1).
  - Semgrep's first run flagged missing release-age cooldowns, so `.npmrc` also sets `min-release-age=7`, and
    Dependabot carried a 7-day cooldown until P0.08 replaced it.
  - The root `package.json` has `"version": "0.0.0"`, because `npm sbom` refuses a versionless root.
Outputs:
  - `ci.yml`: top-level `permissions: {}`; `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress:
    ${{ github.event_name == 'pull_request' }} }` (runs on `main` are never cancelled); triggers `pull_request` and
    `push` to `main` only. Jobs (each `runs-on: ubuntu-24.04`, `timeout-minutes`, `permissions: { contents: read }`,
    `actions/checkout` with `persist-credentials: false`):
    - `check` (15 min): `actions/setup-node` from `.nvmrc` with npm cache → `npm ci` (`.npmrc` sets `ignore-scripts`)
      → `npm run typecheck` → `npm run lint` → `npm run guards` → `npm test` → `npm run budgets` (warnings only).
    - `audit` (10 min): `npm ci` → `npm audit --audit-level=high` → `npm audit signatures` (registry signatures and
      provenance attestations; fails on an invalid signature).
    - `secrets` (10 min): checkout with `fetch-depth: 0`; run the gitleaks CLI from its container image pinned by index
      digest: `docker run --rm -v "$PWD:/repo" -w /repo <gitleaks image>@sha256:… git --redact --config .gitleaks.toml .`
      (full history) and `… dir --redact --config .gitleaks.toml .` (working tree). No action, no token, no run-time
      binary download.
    - `actionlint` (5 min): the `rhysd/actionlint` image pinned by index digest, over `.github/workflows/`.
    - `semgrep` (15 min): the `semgrep/semgrep` image pinned by index digest; `semgrep scan --config p/typescript
      --config p/nodejs --config p/owasp-top-ten --metrics=off --error --sarif --output semgrep.sarif`; the step then
      fails if the SARIF reports zero rules run, and logs the rule-pack versions; the SARIF is uploaded as an artefact.
    - `sbom` (10 min, not required): `npm sbom --package-lock-only --sbom-format cyclonedx > sbom-<sha>.cdx.json`,
      uploaded as an artefact (built into npm; generate, do not gate).
    - `duplicates` (10 min, not required, never fails): `jscpd` (exact devDependency) with `.jscpd.json` (min 40 tokens,
      TS/TSX, `SKIP_DIRS` and fixtures ignored); the report goes to `$GITHUB_STEP_SUMMARY` as advice to the reviewer
      (README rule 10). `continue-on-error: true`.
    Artefact uploads use `actions/upload-artifact` (GitHub-owned, SHA-pinned).
  - **The secrets and OIDC rule** (written as a comment block at the top of `ci.yml` and enforced by the test):
    no repository-level secrets, ever. A later secret lives in a GitHub **Environment** whose deployment branches are
    limited to `main` and whose required reviewer is Alex. `id-token: write` and any `secrets.<NAME>` other than
    `secrets.GITHUB_TOKEN` appear only in a job that declares that `environment:` and has
    `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`. Any OIDC trust policy (cosign keyless, a
    cloud role) pins `ref:refs/heads/main` and the environment name. Triggers `pull_request_target` and `workflow_run`
    are banned (they run with base-branch privileges on PR-controlled input).
  - `.github/required-checks.json`: `["check", "audit", "secrets", "actionlint", "semgrep"]`, the one list the
    ruleset must match (later steps P1.11, P1.26, P1.27 append to it, with the same Alex tail).
  - `.gitleaks.toml`: `[extend] useDefault = true`, plus custom rules:
      `unset-canary` — `UNSET_CANARY_[A-Za-z0-9]{32}` (drills; harmless by construction);
      `multibase-private-key` — `\bz(?:3vL|42t|42u)[1-9A-HJ-NP-Za-km-z]{44}\b` (a K-256 private key in base58btc
        multibase is always 48 characters starting `z3vL`; P-256 starts `z42t`/`z42u`; this is what `goat key generate`
        prints, and default rules do not know it);
      `age-secret-key` — `AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}`;
      `age-plugin-identity` — `AGE-PLUGIN-[A-Z0-9-]+-1[02-9AC-HJ-NP-Z]+`.
    No allowlist entries. Tests that need these strings build them at run time (never committed).
  - `.semgrepignore`: `node_modules/`, `dist/`, `*.generated.*`, `scripts/guards/fixtures/`.

Algorithm (what the agent does):
  1. For each GitHub-owned action (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`) and each image
     (gitleaks, actionlint, semgrep), resolve the commit SHA or multi-arch **index** digest of the newest release at
     least 7 days old (`docker buildx imagetools inspect` shows `application/vnd.oci.image.index.v1+json`); write it with
     a trailing `# vX.Y.Z` comment. Never a tag alone.
  2. Write the jobs. Every `run:` takes values only through `env:`; no `${{ … }}` expression appears inside any `run:`
     (attacker-controlled values include `github.head_ref` and `inputs.*`, not only `github.event.*`).
  3. Write `workflow-pins.test.ts` and `secret-patterns.test.ts` (below); run actionlint locally; fix every finding.
  4. Open the PR; all jobs must pass on it.
  5. Plant tests on a scratch branch (never merged): (a) `UNSET_CANARY_` + 32 random alphanumerics in a `.md` file →
     `secrets` fails; (b) a freshly generated K-256 private multibase (from `goat key generate --type K-256 --terse` on the
     agent's machine, the key then discarded) in a `.md` file → `secrets` fails; (c) a workflow step
     `run: echo "${{ github.head_ref }}"` → `workflow-pins` test (in `check`) or `actionlint` fails; (d) `eval(userInput)`
     in `apps/web/x.ts` → `semgrep` fails. Record each run URL in the PR body. Close the scratch PR, delete its branch.
     The planted values are never pasted into any committed file (a full-history scan would fail forever).
  6. `npm audit` reports a high finding in the current lockfile → no `--omit` or ignore list; open a separate PR bumping
     the dependency, or stop and ask Alex if no fix exists. `npm audit signatures` fails → stop and ask (it means a
     package in the lockfile does not match its registry signature).
  7. Semgrep CE cannot fetch its registry rules (network or licence change), or loads zero rules → the job fails; stop
     and ask; never drop the job.
  8. Alex tail (**deferred until protection exists**, decision 41): ask Alex to add `audit`, `actionlint`, `semgrep` to
     the P0.03 ruleset's required checks, each with source GitHub Actions (Settings → Rules → main protection → Require
     status checks → add).
  9. (Deferred with step 8.) Verify with `gh api repos/…/rulesets/<id>`: the required contexts equal `.github/required-checks.json` exactly, each
     with `integration_id = 15368`.

Edge cases and failures:
  - A dependency needs its install script → `npm rebuild <pkg>` as a named step, listed in the PR; never re-enable
    scripts globally.
  - A job is renamed later → the ruleset still requires the old name and blocks every PR; renames update
    `required-checks.json` and go with an Alex ruleset edit in the same change window.
  - A later step needs a secret or OIDC (P1.27 image signing, deploy, probes) → it adds an environment-bound job
    satisfying the rule above, and Alex creates the environment; the test keeps every other job secret-free.
  - The gitleaks image changes its CLI subcommands (`git`/`dir` replaced `detect`/`protect` in v8.19) → the pinned
    version is the contract; Renovate bumps arrive as reviewed PRs.

Threats: untrusted branch code running in CI next to secrets and the OIDC issuer.
  - T A moved tag or a third-party action runs attacker code → GitHub-owned actions by SHA, tool images by digest
    (`all_actions_sha_pinned`).
  - E A branch workflow reads a secret or mints an OIDC token → only environment-bound jobs on `main` may
    (`secrets_and_oidc_gated`, `least_privilege`).
  - E Script injection through a PR title or branch name → no `${{` in `run:`, no `pull_request_target`/`workflow_run`
    (`no_expression_in_run`, `banned_triggers`).
  - I A secret or private key is committed → full-history gitleaks with the multibase and age rules
    (`secret_patterns`, `planted_canary_fails`, `planted_multibase_fails`).
  - T A tampered or vulnerable dependency → `npm audit`, `npm audit signatures`, install scripts off (algorithm step
    6).
  - R A required check silently dropped or renamed → `required_checks_listed`, `required_checks_set`.

Done when (tests):
  - all_actions_sha_pinned (`workflow-pins.test.ts`): every `uses:` is `actions/<name>@<40-hex>` (GitHub-owned only;
    local `./` actions excepted); every image reference in a `run:` line or `container:`/`image:` key carries
    `@sha256:<64-hex>`.
  - least_privilege: top-level `permissions: {}`; no job requests any `write` permission except `id-token: write` under
    the environment rule.
  - secrets_and_oidc_gated: any job containing `id-token: write` or `secrets.` other than `secrets.GITHUB_TOKEN` declares
    `environment:` and the exact `if:` above; fixture workflows violating each clause → the test fails.
  - banned_triggers: a fixture workflow with `pull_request_target` or `workflow_run` → fails.
  - no_expression_in_run: any `${{` inside a `run:` value → fails (fixture with `${{ github.head_ref }}`).
  - main_runs_not_cancelled: `cancel-in-progress` is the `pull_request` expression, not `true`.
  - required_checks_listed: every name in `.github/required-checks.json` is a job id in `ci.yml`.
  - secret_patterns (`secret-patterns.test.ts`): a K-256 private key built at run time (base58btc of `0x81 0x26` + 32
    random bytes, prefixed `z`) matches `multibase-private-key`; a P-256 one likewise; a `did:key:zQ3s…` value and a
    `sha256:<64 hex>` string do not; an age identity built at run time matches `age-secret-key`.
  - planted_canary_fails, planted_multibase_fails, planted_injection_fails, planted_eval_fails: the step 5 run URLs.
  - required_checks_set (**waiting until protection exists**, decision 41): step 9 output matches the file exactly.

Reuse: bootstrap `ci.yml` → SALVAGE (keep checkout/setup-node pins and job shapes). Bootstrap gitleaks-action
(`ff98106`, v2.3.9) → REJECT (needs `pull-requests: read` on private repos, posts review comments, downloads the binary
at run time without a checksum). Prototype `/home/claude/0x40/.github/workflows/security-gate.yml:35-36` → LESSON
(actions pinned by tag). gitleaks, actionlint, Semgrep CE images, `npm sbom`, `npm audit signatures`, jscpd → USE
(named in plan §6.1/§8 or built into npm; jscpd MIT, exact pin). `anchore/sbom-action` → REJECT (third-party action that
fetches `syft` at run time; npm's built-in SBOM suffices). Provisional — for reuse review.
Not in this step: image build, hadolint, image scan, cosign and SLSA attestations (P1.27, "from the first image",
PI-5); Playwright, axe and Lighthouse (P1.26); Postgres service container (P1.11); ZAP weekly (P5.10); CodeQL (when
public); graphify in CI (PI-2, no step yet); the commit-message and PR-title check, the PR size guard and the PR template
heading check (P0.09c, decision 35).
Diagram: none.


As ruled (architecture thread, 2026-10-05 00:00Z; carried by the Phase 0 thread):
  - Why: PR 23, the first `@unset/*` workspace, turned the audit job red. `npm audit signatures` prefetches signing
    keys for every registry used by any edge, workspace edges included, and `.npmrc` pins `@unset:registry` to
    `https://127.0.0.1:9/` (fail-closed), so the key fetch got ECONNREFUSED.
  - In the `audit` job only, run `npm audit signatures --@unset:registry=https://registry.npmjs.org/`.
  - Comment it in `ci.yml`: the override applies only to the signature-key fetch, and workspaces are never verified
    or downloaded. `.npmrc` stays fail-closed for every install.
  - This is accepted because the command installs nothing. No other job or script may pass the override.
  - Test `audit_override_only_in_audit_job` (`scripts/guards/workflow-pins.test.ts`): the string `@unset:registry=`
    appears in `ci.yml` exactly once, inside the `audit` job's `npm audit signatures` line.

Extended by P1.01s (2026-10-05): custom rule ids must appear in the SARIF rule list. `semgrep-rules-ran.ts` reads the
ids declared under `.semgrep/rules/` and fails if any is missing from `semgrep.sarif`, so the custom rules loading
nothing in the main scan is caught.

---

### P0.08 — Renovate replaces Dependabot; exact pins; lockfile and workspace-link guard
Tags: [SEC] [ALEX] (tail: app install)            Depends on: P0.07            Plan: §6.1 (deps), §9 ("Exact pins … Renovate opens a PR per bump")
Where: new `renovate.json`; delete `.github/dependabot.yml`; new `scripts/guards/dependencies.ts` +
  `scripts/guards/dependencies.test.ts`; CI step in `check` validating `renovate.json`
Size: ~60 lines of config, ~90 source lines, ~140 test lines

Goal: one bot proposes dependency updates as one reviewable PR per bump, never sooner than the agreed release age; the
repository refuses any non-exact version, any `@unset/*` name that is not a local workspace link, and any lockfile entry
that does not come from the public npm registry with an integrity hash.

Inputs: P0.07 merged (so Renovate PRs get the full gate); `.npmrc` (P0.04).
Outputs:
  - `renovate.json`:
      `extends`: `config:recommended`, `helpers:pinGitHubActionDigests`, `docker:pinDigests`,
        `:pinAllExceptPeerDependencies`.
      `rangeStrategy: "pin"`; `minimumReleaseAge: "7 days"`; `internalChecksFilter: "strict"`; `prConcurrentLimit: 5`;
      `prHourlyLimit: 2`; `separateMajorMinor: true`; `automerge: false`; `dependencyDashboard: true`;
      `labels: ["deps"]`; `branchPrefix: "renovate/"`; `lockFileMaintenance: { enabled: true, schedule: ["before 6am on
      monday"] }`. As built (PR #15): a regex `customManager` keeps the digest-pinned `*_IMAGE` variables in `ci.yml`
      up to date.
      `vulnerabilityAlerts`, set explicitly (Renovate's built-in default is `minimumReleaseAge: null`, `rangeStrategy:
      "update-lockfile"`, `prCreation: "immediate"`, and our object merges into it): `{ labels: ["security"],
      minimumReleaseAge: "7 days", rangeStrategy: "pin" }`. 7 days is the plan's rule (§6.1, no exception) and stays
      the default until Alex answers P0-A2 (the reviewer recommends immediate PRs for advisories, Alex's merge being the
      gate; provisional).
      `packageRules`: (1) group `@atproto/**` into one PR "atproto packages" (plan §9); (2) `matrix-js-sdk` and
      `@matrix-org/**` one PR each, label `chat`; (3) GitHub Actions digests pinned, one PR per action; (4) Docker index
      digests pinned; (5) `@unset/**` disabled (`enabled: false`): they are workspaces, never registry packages.
  - `scripts/guards/dependencies.ts`:
      `scanManifest(path, json, workspaces: Set<name>, lock): Finding[]` over `dependencies`, `devDependencies`,
        `optionalDependencies` (not `peerDependencies`): a value must be an exact semver
        `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`, except `"*"` for a name in `workspaces` **and** present in the lockfile as
        `node_modules/<name>` with `"link": true`. So `^`, `~`, ranges, `latest`, `workspace:` (npm does not support it),
        `git+`, `file:`, `http(s):` and `"*"` for an unknown or unlinked `@unset/*` name all fail.
      `scanLockfile(lock): Finding[]`: every package entry that is not `"link": true` has `resolved` starting
        `https://registry.npmjs.org/` and an `integrity` starting `sha512-`; no `resolved` beginning `git+`, `file:` or
        `http:`.
      `workspaceNames(root)`: names declared by the `package.json` of every folder the root `package.json`
        `workspaces` globs match (`apps/*`, `interfaces/*`, `domains/*`, `infrastructure/*`, `shared/*`; as built,
        PR #15), read from the root manifest rather than a fixed list.
      `scanNpmrc(text)`: contains `ignore-scripts=true` and `@unset:registry=https://127.0.0.1:9/`.
  - CI: a step in `check` runs `renovate-config-validator` from the `renovate/renovate` image pinned by index digest
    (as built: `renovate/renovate:44.115.13` by index digest, `--entrypoint renovate-config-validator`, run with
    `--strict`). No `npx`.
  - Alex sub-checklist (PR body): install the Renovate GitHub App (Mend) on **only** this repository (P0-A7); confirm it
    opened the Dependency Dashboard issue; close any Dependabot PR still open. **Done** (2026-10-04): the app is
    installed on the `unset` repository only; Dependabot **security updates** are turned off and Dependabot **alerts**
    stay on.

Algorithm:
  1. Write `renovate.json`; run the validator locally with the pinned image; fix errors.
  2. Delete `.github/dependabot.yml` in the same PR.
  3. Write the guard and its tests; run it over every `package.json` and `package-lock.json` in the repository.
  4. After merge, Alex installs the app (tail). Wait for Renovate's first run (timeout: 24 h, then ask Alex to check the
     install). Check the Dependency Dashboard issue lists the actions, images and npm packages and shows "pending
     minimum release age" for fresh releases.

Edge cases and failures:
  - A security advisory → Renovate opens a PR after 7 days (default until P0-A2); if Alex wants it sooner he asks an agent
    for a manual bump PR, which still needs his approval.
  - A workspace package is renamed or removed while another manifest still names it → `"*"` without a lockfile link →
    finding; and `.npmrc` makes `npm install` fail rather than fetch the third-party package.
  - Renovate proposes a major `@atproto/*` bump → one grouped PR; the agent reviewing it reads the changelog (plan §9).
  - The app cannot be scoped to one repository → stop; do not install it account-wide.
  - Transitive dependencies → pinned by the lockfile; `scanLockfile` checks their source and integrity.

Threats: third-party packages entering the lockfile.
  - T A range or tag resolves to a new, possibly malicious release → exact pins only and a minimum release age
    (`pins_reject_ranges`, `renovate_vuln_policy_explicit`, `renovate_config_valid`).
  - S Dependency confusion on the `@unset` scope (a third party owns it on npmjs.org) → local workspace links only,
    scope blocked in `.npmrc` (`pins_reject_unknown_internal_star`, `pins_reject_unlinked_internal_star`,
    `npmrc_blocks_scope`).
  - T A lockfile entry from a git host or without an integrity hash → `lockfile_rejects_foreign_resolved`.

Done when (tests): (`scripts/guards/dependencies.test.ts`)
  - pins_reject_ranges: `"a": "^1.0.0"`, `"b": "~2.0.0"`, `"c": "latest"`, `"d": "git+https://x"`, `"e": "file:../e"` → 5.
  - pins_accept_exact: `"a": "1.2.3"`, `"b": "1.0.0-rc.1"`, and `"@unset/core": "*"` with a workspace and a lockfile link
    → 0.
  - pins_reject_unknown_internal_star: `"@unset/ghost": "*"` with no such workspace → 1.
  - pins_reject_unlinked_internal_star: `"@unset/core": "*"` declared as a workspace but the lockfile entry has no
    `"link": true` (resolved from a registry) → 1.
  - pins_reject_workspace_protocol: `"@unset/core": "workspace:*"` → 1.
  - lockfile_rejects_foreign_resolved: an entry resolved from `https://codeload.github.com/…` → 1; one without
    `integrity` → 1; one with `http://registry.npmjs.org/…` → 1.
  - npmrc_blocks_scope: the real `.npmrc` passes `scanNpmrc`; a copy without the scope line fails.
  - renovate_vuln_policy_explicit: `renovate.json` has `vulnerabilityAlerts.minimumReleaseAge` **present** (whatever
    value P0-A2 settles) and `vulnerabilityAlerts.rangeStrategy` ≠ `update-lockfile`.
  - repo_clean: every manifest and the lockfile in the repository → 0.
  - renovate_config_valid: the validator step passes in CI.
  - dependabot_removed: `.github/dependabot.yml` does not exist.
  - first_run_seen: (after Alex's install) the dashboard issue URL, recorded in a PR comment.

Reuse: bootstrap `.github/dependabot.yml:1-11` → REJECT (replaced, plan §6.1). Renovate → USE (plan §8/§9).
`npx renovate-config-validator` → REJECT (unpinned transitive tree, install scripts run). Provisional — for reuse review.
Not in this step: Tap pinned-commit tracking (custom manager, P3.02); base-image digests (P1.27); owning a scope (P0-A5).
Diagram: none.


As built and ruled (Phase 0 thread, PR 25 and its follow-up; architecture thread, 2026-10-05 00:00Z, confirmed):
  - `npm ci` follows each lockfile entry's `resolved` URL, so a tampered lockfile could fetch a third-party
    `@unset/*` package despite `.npmrc`. This step's `scripts/guards/dependencies.ts` already required every
    `node_modules/@unset/*` entry to be `"link": true` to a workspace folder; a registry URL, a `file:` path or a `../`
    path fails. No separate guard is added to P0.06.
  - Gaps closed: a link entry carrying `integrity` fails; a link must point each name at that workspace's own folder
    (the folder whose `package.json` declares the name), so a trusted name can never point at another folder.
  - `resolved` may hold only the relative path of a declared workspace (confirmed by the architecture thread).
  - Test `lockfile_unset_links`: a registry URL, `"link": false`, `../outside`, an `integrity` field, `file:`, a link
    with no `resolved`, and `@unset/core` linked to `@unset/other`'s folder (the book's `@unset/identity` linked to
    `@unset/content`'s folder, same check) each fail;
    `{ "resolved": "shared/core", "link": true }` under `@unset/core` passes.

---

### P0.09 — Repository docs: slim CLAUDE.md/AGENTS.md, SECURITY.md, licence line, ADR index, the book
Tags: —            Depends on: P0.03, P0.05 (the dependency-cruiser config the architecture test reads)            Plan: §8 Phase 0 ("Slim CLAUDE.md/AGENTS.md"), §6.1
Where: `CLAUDE.md`, `AGENTS.md`, `SECURITY.md`, `README.md`, `docs/human/decisions/README.md`, new `docs/ai/book/`,
  new `docs/human/glossary.md`, new `.github/pull_request_template.md`, new `scripts/docs/docs.test.ts`, new
  `docs/human/decisions/0011-no-orchestrator-until-measured-need.md` (0011: the architecture table's AB-3 row already
  cites it)
Size: ~0 source lines, ~250 lines of docs (plus the book copy), ~50 test lines

Goal: an agent that opens the repository is pointed at the plan, the engineering instructions and this book, and reads
nothing it does not need; the repository copy of the book becomes the only copy that changes.

Inputs: bootstrap `CLAUDE.md`, `AGENTS.md`, `SECURITY.md`, `docs/human/engineering/*`; the reviewed book;
`docs/human/architecture.md` (rule AB-4; drafted by the architecture thread and pushed by the plan thread, not written
here); P0.05's `.dependency-cruiser.cjs`.
**Architecture ruling (editor pass, 2026-10-04 evening).** `CLAUDE.md` has **five** imports: the four guideline
documents in `docs/human/engineering/` (architecture instructions, architecture and development guideline, practices
addendum, workflow and change management) plus the engineering-rules Top 15 page; a test checks the Top 15 is among
them. The line budget is **120**, not 80. `engineering-rules.md`'s Top 15 intro now reads: "Of this rules file,
CLAUDE.md imports this Top 15 page only (alongside the four guideline documents); the full set is read on demand."
This step logs that as a deviation (in its PR body and in the reconciliation ADR 0007's table). Decision 41 adds to the
Delivery section: **agents never merge and never push to `main`** (Alex alone merges; ADR 0009).

Outputs:
  - `CLAUDE.md` (≤ 120 lines): keep the bootstrap sections (security, protocol-first, branches, commands), except any
    UI design section: the 0x40 "v2e" visual direction (amber, serif face, chamfers, `UiIcon`/`iconoir-react`) is
    **superseded** by the unset.sh design sheet (P1.21's design-source ADR), and `CLAUDE.md` says so in one line naming
    the old vault note `v2e-visual-direction-locked` so no agent follows it (phase-1 Notes item 21). A second line names
    the icon set (Alex, 2026-10-03 18:00Z, alex-answers #12b): "Icons: Iconoir 7.12.1, only the SVGs copied onto the
    design sheet's Icon list, through `shared/ui` `Icon` (P1.24); never the iconoir npm package or any other icon
    package." Nothing else from v2e comes back; link
    `docs/human/engineering/` (architecture instructions, practices addendum, workflow and change management, engineering
    rules) as binding. **Decision 35 (already in the bundle's `CLAUDE.md`, kept), with the architecture ruling:** five
    import lines, the four guideline documents and `@docs/human/engineering/engineering-rules-top-15.md` (the rules'
    Top 15 page only, never the full rules file), plus the full rules' path
    `docs/human/engineering/engineering-rules.md`; the precedence rule (the plan wins over a rule; the architecture
    guideline wins on structure); and a **Delivery** section: D1 (a function does one job at one level of abstraction;
    never split to meet a line count), D2 (commit subjects and PR titles `P1.07 Enforce exact Origin match in CSRF
    gate`, Beams' rules, no Conventional Commits prefix, kind of change as a PR label, squash-only), D3 (warn above about
    400 changed source lines, fail above 800 without `large-pr` and a reason), D4 (at most three agent PRs waiting for
    Alex; run `gh pr list --state open` before starting a step; severity-1 and -2 fixes excepted) and D8 (ADR 0001 is an
    append-only decisions log; every new decision gets its own ADR in `docs/human/decisions/`; accepted ADRs are
    immutable, changed only to mark them superseded), and from decisions 40 and 41: **agents open PRs and never merge;
    agents never push to `main`; Alex alone merges** (the rule GitHub cannot enforce on the free private plan, ADR
    0009). This step verifies that content, and adds what is missing.
    Add "Building from the book": the next step is the lowest-numbered step in `docs/ai/book/` whose dependencies are
    merged and that has no open PR; stop at `[ALEX]`, `[STOP]`, `[SPIKE]` exits as the book says; one PR per step,
    titled as in the Delivery section. One line on AI notes (plan §7, Alex 2026-10-04 22:11Z): before touching an area,
    read its `importance: high` notes in `docs/ai/notes/`, and capture durable learnings there (P0.09d builds the vault
    and its guard); no hand-made notes table. The 120-line budget counts `CLAUDE.md` itself; the imported top-15 page
    (about 20 lines) is checked separately (≤ 25 lines).
  - `AGENTS.md`: unchanged pointer to `CLAUDE.md`.
  - `SECURITY.md`: scope lists every entrypoint of plan §7 (`web`, `api`, `indexer`, `media`, `review`, `admin`,
    `pds-admin`, `chat-admin`) plus the PDS, Tap and Matrix as upstream; reporting channel: an email address Alex
    chose, **`security@unset.sh`** (real mail exists behind it, P0.11; GitHub private vulnerability reporting is not
    available while the repository is private); acknowledge in 3 working days (bootstrap text).
  - `README.md`: "Licence: AGPL-3.0-only, provisional until decided (P0.13); the repository stays private until then."
  - `LICENSE`: unchanged (bootstrap AGPL-3.0 text).
  - `docs/ai/book/`: a copy of the reviewed book files (`00-README.md`, `01-outline.md`, `02-shared-blocks.md`,
    `03-glossary.md`, `phase-*.md`, `launch-gate.md`, `plan-issues.md`; not `reviews/`), with `docs/ai/book/README.md`
    naming the source folder, the review round and the date. From this PR on, **the repository copy is canonical**:
    the planning folder is frozen and later book changes land as PRs here (default; the coordinator confirms).
  - `docs/human/decisions/README.md`: rows 0001 (append-only decisions log, D8), 0002 (engineering rules, decision 35),
    0003 (decision 36: a private member is not found by handle in chat), 0004 (decision 37: what another app can show,
    unset.sh shows), 0005 (decision 38, Spaces), 0006 (decision 39), 0007 (the bootstrap reconciliation, P0.02), 0008
    (decision 40, the ruleset shape), 0009 (decision 41, no ruleset on the free private plan), 0010 (decision 42,
    opaque Matrix ids) and 0011 (the no-orchestrator ADR below). `adr_index_complete` checks rows against files, never
    fixed numbers.
  - No-orchestrator ADR (findings F-23; rule AB-3): Context (one host, Compose, IaC deferred to P5.00, decision 14);
    Decision (no Kubernetes, service mesh, operator, autoscaler or multi-region until a measured need beyond one host
    that Compose with `docker-rollout` cannot meet; an orchestrator PR must cite that measurement); Alternatives (k3s
    now; Nomad; Compose plus `docker-rollout`); Consequences (the Kubernetes patterns already realised in Compose:
    health and readiness checks, restart policies, per-service resource limits (P1.29, P5.02), rolling web deploys
    (P5.03), digest-pinned signed images (P1.27)); Compliance (AB-3's ADR rule; reviewed when the trigger fires).
    F-23 asked for it "with P0.04's ADRs"; P0.04 writes none, so it sits with the ADR index here (editor, decision 35).
  - `docs/human/glossary.md`: the book's `03-glossary.md`, moved here as the one canonical glossary (guideline §6 lists
    the glossary under `docs/human/`; findings F-20). `docs/ai/book/03-glossary.md` is a one-line pointer to it; later
    glossary changes are PRs to `docs/human/glossary.md`.
  - `.github/pull_request_template.md` (README readable-code rule 11; findings F-33): headings `Step` (the step id and a
    link to it), `What`, `Why`, `How to test`, and `Security review` (for a `[SEC]` step or a CODEOWNERS security path:
    the threats it addresses, from the step's `Threats` heading). Then DL-3's other fields, each filled or marked
    `n/a`: `Ownership path`, `Threats` (link), `ASVS rows`, `Red evidence` (the failing test before the fix),
    `Behaviour change`, `Performance evidence`, `Migration or rollback`, `Why this works (source read)`, `Needs an
    ADR?`, `Branch age`, `What I am unsure about` (rule DL-3 as adopted, decision 35; `Step` carries the step id and why).
    Then one line `AI notes: updated / none needed / which` (plan §7, Alex 2026-10-04 22:11Z; the author keeps one
    choice and names the notes).
    One template (architecture thread, 2026-10-04, findings F-33); the agent self-reviews against it before asking Alex.
    `Large PR:` (a reason line) is optional and read by P0.09c's size check.

Algorithm:
  1. Write the CLAUDE.md, SECURITY.md, README.md edits, the ADR index, ADR 0011, the PR template and the tests. Keep
     CLAUDE.md within 120 lines (it is loaded into every agent run).
  2. **Last act:** copy the book snapshot (frozen at that moment) into `docs/ai/book/` unchanged; move `03-glossary.md`
     to `docs/human/glossary.md` and leave the pointer. Nothing in the PR is written after the copy, so the copy is
     the newest book.
  3. Run gitleaks locally (the pinned image) over the new files before committing.
  4. Open the PR.

Edge cases and failures:
  - The book is still under review when this step runs → copy the latest round; `docs/ai/book/README.md` says "snapshot of
    round N"; the coordinator then makes one refresh PR and freezes the planning folder.
  - A book file contains a planted test value (canary, key) → never; book files contain patterns only. If gitleaks flags
    a book file → stop and report which line.

Done when (tests): (`scripts/docs/docs.test.ts`)
  - claude_md_short: `CLAUDE.md` has ≤ 120 lines and links `docs/ai/book/`, `docs/ai/PLAN.md` and `docs/human/engineering/`.
  - claude_md_rules_import: `CLAUDE.md` has exactly five import lines, each resolving to a file: the four guideline
    documents and `@docs/human/engineering/engineering-rules-top-15.md`, **the Top 15 among them** (a fixture without
    it fails); no import of the full `engineering-rules.md`. The Top 15 file has ≤ 25 lines and its numbered rules equal
    the "Top 15" section of `engineering-rules.md`; `CLAUDE.md` names `engineering-rules.md`, states the precedence
    rule, and its Delivery section mentions D1, D2, D3, D4 and D8 (a fixture without the precedence line fails).
  - claude_md_agents_never_merge (decisions 40 and 41): the Delivery section says agents never merge and never push to
    `main`, and names ADR 0009; a fixture without either line fails.
  - adr_index_complete: every file in `docs/human/decisions/` has a row in its `README.md` and every row a file; each ADR
    other than 0001 has the headings Context, Decision, Alternatives (at least two), Consequences, Compliance and a
    status (rule DO-1).
  - adr_immutable (D8, rule DO-2): against `origin/main`, a changed ADR with status Accepted fails unless the change only
    sets its status to "Superseded by NNNN"; ADR 0001 may only gain lines at its end (an edited or deleted line fails).
  - security_md_scope: `SECURITY.md` names all eight entrypoints.
  - v2e_superseded: `CLAUDE.md` contains no instruction to use amber, chamfers, a serif display face, `UiIcon` or the
    `--v2e-*` tokens, and names `v2e-visual-direction-locked` as superseded; it does name Iconoir as the unset.sh icon
    set, scoped to the design sheet's Icon list and `shared/ui` `Icon` (P1.24), and forbids icon packages (a fixture
    `CLAUDE.md` saying "use iconoir-react" or "amber accent" fails; one without the Iconoir line fails).
  - book_snapshot_marked: `docs/ai/book/README.md` names a round and a date.
  - glossary_canonical: `docs/human/glossary.md` exists and has a heading per glossary word; `docs/ai/book/03-glossary.md`
    is a pointer of at most three lines naming it.
  - pr_template_headings: `.github/pull_request_template.md` has the five headings above, then the eleven DL-3
    fields, in that order, then the `AI notes: updated / none needed / which` line; a PR body missing one fails P0.09c's
    `pr-shape` check unless it says `n/a` (the AI notes line must keep one of its three choices).
  - no_secrets: the PR's `secrets` job passes.
  - architecture_rule_table_matches_depcruise (rule AB-4): parse the rule table of `docs/human/architecture.md` (one row
    per architecture rule: id, *checked* with the check's name, *planned*, or *review-only* with a reason). Table
    convention (architecture thread, final table): a *planned* cell holds only `planned: <step id>`; the test accepts
    it only while no commit on `main` carries that step-id prefix (D2 puts the id first in every squash subject), so the
    PR of the named step flips its own row to *checked*; a planted cell `planned: P0.05` (merged) fails, and a planned
    cell with any other text fails. The step ids are cross-checked against
    `architecture-handoff/architecture-table-final.md` when this step runs (P1.01, P1.11, P3.03, P0.09c today). Every *checked* row
    whose check is a dependency-cruiser rule names a rule that exists in `.dependency-cruiser.cjs` (`forbidden` name,
    or `MATRIX` for AB-1); every `forbidden` rule in the config and the `MATRIX` itself appear in some row; every other
    *checked* row names a test or guard that exists in the repository; every *review-only* row has a non-empty reason.
    A fixture table naming a missing rule, a config rule missing from the table, or an empty reason fails; the test
    also fails when it parsed zero rows. `docs/human/architecture.md` absent → the test fails and the step stops to ask
    the plan thread for it (it is an input, never written here).

Reuse: bootstrap `CLAUDE.md`, `SECURITY.md`, `LICENSE` → SALVAGE. Provisional — for reuse review.
Not in this step: the AI notes vault and its guard (P0.09d; no old note is carried wholesale, P0.09a); compliance docs (P1.36); runbooks (their own steps); the licence (P0.13);
the commit-message, PR size and PR template CI checks (P0.09c).
Diagram: none.

---

### P0.09a — Carried-over notes from the prototype (**retired**, plan §8 Phase 0, Alex 2026-10-04 22:11Z)
**Retired (editor pass, 2026-10-04 evening).** The plan now says: "no old 0x40 vault note is carried over here, each is
ported only when a step needs it, re-checked" (§7, §8 Phase 0; template rule 6). Do **not** build this step: no bulk
copy, no `docs/ai/notes/README.md` index. P0.09d starts the vault; each phase's `.00` refine step ports the old notes
that phase needs (00-README), in the template's header with a fresh `checked` date. The text below is kept only as the
list of candidate notes and the redaction rules a port follows (read fully, redact secrets, emails, IPs and names;
rewrite links to `0x40@054ab0f:<path>`; mark plan contradictions).

Tags: —            Depends on: P0.09            Plan: §8 Phase 0 ("Carry over the vault notes from review 07 §6 and archive the rest")
Where: new `docs/ai/notes/` (carried notes), `docs/ai/notes/README.md`; extends `scripts/docs/docs.test.ts`
Size: ~0 source lines, ~70 copied notes, ~30 test lines

Why a separate step: carrying the notes means reading and redacting about 70 files, which is too much review load to
share an approval with P0.09 (review r1 F25). Added with a letter suffix so no id shifts.

Goal: the notes that record protocol traps and past decisions are in the repository as plain, clearly historical
Markdown, each read and redacted before it is copied.

Inputs: the prototype at `054ab0f` (read-only at `/home/claude/0x40`); review 07 §6 carry list.
Outputs:
  - `docs/ai/notes/`: copied from `/home/claude/0x40/.claude/notes/`, each with a first line
    `> Imported from 0x40@054ab0f:<path>. Historical; code is the source of truth.`:
      research: every `research/atproto-*.md` (**21** files at `054ab0f`), `pds-key-custody-and-disaster-recovery.md`,
        `matrix-key-backup-and-secret-storage.md`, `user-media-pipeline-best-practices.md`, `pds-blob-storage-options.md`;
      pitfalls: all of `pitfalls/` except `accounting-paid-now-posts-cash-not-ar.md` and `ledger-write-only-unread.md`
        (25 files; `crm-webhook-ssrf-redirect-rebind.md` is kept, it is the SSRF lesson behind `net-guard`);
      lessons: all 3; reference: `matrix-encrypted-file-invariants.md`, `matrix-room-access-control.md`,
        `mas-branding-is-config-or-all-templates.md`;
      decisions (13): `confidential-client-private-key-jwt`, `oauth-against-the-pds`,
        `language-split-typescript-app-go-dataplane`, `browser-matrix-client-trust-boundary`, `takedown-needs-the-pds`,
        `peer-provisioning-needs-mas-not-synapse`, `matrix-device-trust-and-isolation-posture`,
        `account-invite-code-policy`, `handle-resolution-architecture`, `security-architecture-review-2026-07-20`,
        `security-posture-and-residual-hardening`, `ethical-engagement-and-friction-principles`,
        `settings-privacy-separate-from-page-editor`.
  - `docs/ai/notes/README.md`: the index (id · one-line summary · path) and one line: "The archive of every other note is
    the prototype repository at `054ab0f`; nothing else is copied." Plus a short "Superseded, not carried" list:
    `decisions/v2e-visual-direction-locked.md` and `decisions/v2e-polished-hybrid-direction.md`, superseded by the
    unset.sh design sheet (P1.21).
  - The protocol-notes table in `CLAUDE.md` (P0.09) now resolves.

Algorithm:
  1. List the files to carry from the prototype (`ls` at `054ab0f`); any listed name that does not exist → list it in
     the PR body; do not guess a replacement.
  2. For each note: read it fully (salvage rule: never copy unread text). It contains a secret, a real email address, an
     IP address, or a person's name other than Alex's handle → replace the value with `[redacted]` and say so in the PR
     body. It is CRM, accounting or billing specific → skip it and say so.
  3. Rewrite links that point at prototype paths into the form `0x40@054ab0f:<path>` (non-resolving, so nobody mistakes
     them for files here).
  4. A note contradicts the plan (e.g. recommends Jetstream) → keep it and add under the header: "Superseded by plan
     §<n> on <topic>."
  5. Write the index; run gitleaks (pinned image) locally; open the PR.

Edge cases and failures:
  - The vault tool (`.claude/notes/.bin/vault`) and its pre-commit check are not carried; notes are plain Markdown and
    the guard tests carry the rules (editor note 11, agreed).
  - A note is longer than one screen → copied as is; splitting is not this step's job.

Done when (tests): (added to `scripts/docs/docs.test.ts`)
  - notes_have_provenance: every `docs/ai/notes/**/*.md` except the README starts with the `> Imported from 0x40@054ab0f:`
    line.
  - notes_index_complete: every file in `docs/ai/notes/` (except README) appears in `docs/ai/notes/README.md`, and every index
    entry exists.
  - no_secrets: the PR's `secrets` job passes.

Reuse: prototype `.claude/notes/**` → USE as text (historical, per review 07 §6). Vault tool → REJECT (plain Markdown;
tests carry the rules). Provisional — for reuse review.
Not in this step: new notes (written by later steps when they learn something durable).
Diagram: none.

---

### P0.09b — Severity definitions, labels, bug template and triage form
Tags: [ALEX]            Depends on: P0.03, P0.07            Plan: §8 launch gate ("no severity-1 or severity-2 bug open (severity-3 triaged)"), §10 ("severity-based gate"); phase-5 and launch-gate round 1 F21
Where: `docs/human/severity.md`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/labels.json`,
  new `scripts/docs/severity.test.ts`
Size: ~0 source lines, ~90 lines of docs and YAML, ~70 test lines

Why here (letter suffix): severity labels are used from the Phase 2 test track onwards and throughout Phase 5 (P5.05,
P5.10, P5.12), so they cannot wait for the launch gate. L.02 keeps only the gate check and reads this step's files
(phase-5 and launch-gate Notes, round 1 F21).

Goal: every bug from the first one carries exactly one agreed severity, filed through one template and triaged in one
fixed comment form that the launch gate (L.02) can parse.

Inputs: the draft definitions in launch-gate L.02 (adopted here and removed from there by the launch-gate editor);
  `SECURITY.md` (P0.09) for the private reporting channel.
Outputs:
  - `docs/human/severity.md` (status line "confirmed by Alex 2026-10-03 (P5-A5 = L-A1)"; no "draft" marking):
    - **Severity 1**: a security or privacy failure (auth bypass, exposed session or token, private content written to
      a repo or shown to someone else, an IP or user agent stored outside the sealed exception, a printed secret); a
      legal-duty failure (the abuse-material check, report or preservation path, erasure or export does not work);
      data loss or corruption a restore cannot repair; a core flow broken for all users; a restore drill that fails; a
      compliance-mode retain-until set beyond its cap.
    - **Severity 2**: a core feature wrong for some users with no reasonable workaround; a plan §2 rule or §6.1
      standard violated without a known exploit; a blocking WCAG 2.2 A/AA failure on a core flow; a missed §6.1 budget
      on a core surface; a moderation or appeal path that loses or misroutes a case; data loss a restore can repair; a
      restore drill that passed but over RTO.
    - **Severity 3**: everything else.
    - **Rule of doubt**: when two severities are plausible, the higher applies until Alex lowers it.
    - **Upstream-mitigation downgrade**: an `upstream` bug (Synapse, the PDS, Tap, Ozone) may drop one level, never
      from 1 to 3, only when a mitigation is deployed, a test covering it ran in the latest gate run, and Alex confirms
      in the triage comment.
  - `.github/labels.json` (one list; the agent creates the labels from it with `gh label create`): `bug`, `sev-1`,
    `sev-2`, `sev-3`, `triaged`, `upstream`, `security-review`, each with a one-line description.
  - `.github/ISSUE_TEMPLATE/bug.yml`: required fields "what happened", "expected", "steps", "proposed severity"
    (dropdown `sev-1` | `sev-2` | `sev-3`) and "definition line it matches"; it applies the `bug` label only (the
    severity label is set at triage). `config.yml`: `blank_issues_enabled: false`, and a contact link to the private
    channel in `SECURITY.md` for anything that may be a vulnerability (never a public issue).
  - Triage comment form (fixed, one field per line, parsed by L.02's `triage_comment_format_parsed`):
    `Triage: sev-<1|2|3>` / `Matches: <definition line>` / `Decision: fix | accept-for-launch | upstream-mitigated` /
    `Mitigation test: <test id>` (only for a downgrade) / `Confirmed-by: Alex <YYYY-MM-DD>` (required for `sev-1`,
    `sev-2` and every downgrade).

Algorithm:
  1. Write the four files from the outputs above.
  2. Create or update the labels from `labels.json` (`gh label create --force`); a label on GitHub that is not in the file
     is left alone and listed in the PR body.
  3. Open the PR. Alex already confirmed the definitions as drafted (P5-A5 = L-A1, answered 2026-10-03 11:46Z), so the
     status line says "confirmed" from the first commit; the agent proposes severities, Alex confirms every `sev-1`,
     `sev-2` and downgrade.

Edge cases and failures:
  - A vulnerability arrives as a public issue → the agent does not discuss details there; it points to `SECURITY.md` and
    asks Alex to move it to a private advisory.
  - Alex changes a definition later → one PR to `docs/human/severity.md`; open bugs are re-triaged against it.

Done when (tests): (`scripts/docs/severity.test.ts`)
  - severity_doc_complete: `docs/human/severity.md` defines severity 1, 2 and 3, the rule of doubt and the downgrade rule, and
    has a status line.
  - labels_listed: `labels.json` contains the seven labels, each with a description, no duplicates.
  - bug_template_fields: `bug.yml` parses as YAML; the "proposed severity" dropdown offers exactly `sev-1`, `sev-2`,
    `sev-3`; `config.yml` disables blank issues and links `SECURITY.md`.
  - triage_form_example_parses: the example comment in `docs/human/severity.md` parses with the same parser L.02 uses
    (a small shared test helper in `scripts/docs/`, reused by L.02's script).
  - labels_exist (checked): `gh label list --json name` contains every label in the file; output in the PR.

Reuse: launch-gate L.02 draft definitions → USE as text. Provisional — for reuse review.
Not in this step: the gate itself (L.02); the incident runbook (P1.37); private security advisories (P0.10 settings);
the `large-pr` and `kind/*` labels (P0.09c appends them).
Diagram: none.

As built (2026-10-05):
  - YAML parser: `yaml` 2.9.1 (eemeli/yaml, ISC, no dependencies), an exact devDependency. It is the parser P0.09d's
    Reuse line names, and it is there for Phase 1's YAML parse tests (P1.29 and the workflow checks).
  - The triage parser is `scripts/docs/triage.ts`: `readDefinitions(severity.md)` and `parseTriage(comment,
    definitions)`. It reads the fields in their fixed order and stops at the first order error. Review findings added
    three rules:
    - `Matches` must be a definition line of the claimed severity (the rule of doubt);
    - a downgrade carries a new field, `Downgraded-from`, exactly one level above `Triage`, so "one level, never from
      1 to 3" can be checked;
    - a downgrade needs `Mitigation test` and `Confirmed-by` at any severity.

    The `upstream` label is L.02's to check. Extra tests: `definitions_read_from_severity_doc`,
    `sev_3_needs_no_confirmation`, `sev_1_and_sev_2_need_alex`, `matches_a_definition_of_its_severity`,
    `downgrade_drops_one_level_with_test_and_alex`, `downgrade_needs_every_field`, `fixed_order_and_known_fields_only`,
    `confirmation_date_is_a_real_day`, `blank_lines_and_any_line_ending_are_accepted`.
  - GitHub enforces an issue form's `required` only on public repositories ("Syntax for GitHub's form schema"). While
    the repository is private, triage asks for any empty field, as severity.md says.
  - `labels.json` entries also carry a `color`, so re-creating a label is reproducible. The labels were created through
    the REST labels API (the same effect as `gh label create --force`). The repository's other labels (GitHub's
    defaults, plus `accessibility`, `dependencies`, `github_actions` and `javascript` from Renovate and Dependabot)
    were left alone.
  - "definition line" is a one-line `input`, not a `textarea`.

---

### P0.09c — Change-shape checks: commit messages and PR title, PR size, PR template headings (added, decision 35)
Tags: [ALEX] (tail: required check) [SEC]            Depends on: P0.07, P0.08, P0.09, P0.09b, P0.09e, P0.03 (the trusted-base section)           Plan: §8 Phase 0 CI list (commit-message and PR-title check, PR size guard, PR template heading check; decision 35, rules DL-1, DL-3, DL-6, D2, D3); §9 trusted base (rule SE-6); §6.1 Data access (rule PF-1)
Where: new `scripts/guards/commit-msg.ts`, `scripts/guards/pr-size.ts`, `scripts/guards/pr-template.ts`,
  `scripts/guards/trusted-base.ts`, `scripts/guards/perf-evidence.ts`, `scripts/guards/change-shape.ts`,
  `scripts/guards/change-shape.test.ts`, new `.githooks/commit-msg`; `.github/workflows/ci.yml` (new job `pr-shape`);
  `.github/CODEOWNERS` (the `# checks:` line);
  `.github/required-checks.json` (appends `pr-shape`); `.github/labels.json` (appends labels); `renovate.json`
  (commit prefix). The grant classifier (`grant-sql.ts`, `grant-json.ts`, `grant-parse.ts` and their tests) is P0.09e's.
Size: ~565 source lines as built

Why here (letter suffix): the plan's Phase 0 CI list gained these three checks with decision 35 (2026-10-04); they need
the CI workflow (P0.07), the PR template (P0.09) and the label list (P0.09b), so they come after all three.

Goal: the subject that lands on `main` (the PR title under squash-only merging), every commit subject, the size of a PR
and the presence of the PR template's headings are checked by one CI job, with the same pure functions usable locally.

Inputs: P0.07 `ci.yml` and its secrets/expression rules; P0.09 `.github/pull_request_template.md`; P0.09b `labels.json`;
  P0.01's squash settings (title = PR title, message = commit messages).
Outputs:
  - `checkCommitMessage(message: string) -> { ok: true } | { ok: false, errors: CommitMsgError[] }` (pure), Beams'
    rules with our step-id prefix (rule DL-6): subject = `<step id> <Summary>` where the step id matches
    `^(P[0-6]\.\d{2}[a-z]?|L\.\d{2}[a-z]?)$`; after the id, the summary starts with a capital letter, has no trailing
    period, is at most 50 characters (counted after the id) and the whole subject at most 72; no Conventional Commits
    prefix (`^[a-z]+(\(.+\))?!?: `); if a body exists, a blank line separates it and no body line exceeds 72 characters
    (a URL-only line exempt). Errors: `subject.no_step_id`, `subject.conventional_prefix`, `subject.lowercase`,
    `subject.trailing_period`, `subject.too_long`, `body.no_blank_line`, `body.line_too_long`. Merge and revert
    commits GitHub writes (`Revert "…"`) pass when the reverted subject passes. "Imperative mood" is review-only (no
    reliable check).
  - `checkPrTitle(title)` = the subject rules of `checkCommitMessage` (the title becomes the squash subject).
  - `measurePrSize(numstat: string, labels: string[], body: string) -> { changed, level: "ok" | "warn" | "fail",
    reason? }` (pure): sums added + deleted lines from `git diff --numstat <base>...<head>`, excluding test files
    (`*.test.*`, `*.spec.*`, `tests/**`, `**/fixtures/**`), `package-lock.json`, `*.generated.*` and lexicon JSON
    (`shared/lexicons/**/*.json`); binary rows (`-`) count 0. `changed ≤ 400` → ok; `400 < changed ≤ 800` → warn;
    `> 800` → fail, unless labels contain `large-pr` **and** the body has a non-empty `Large PR:` line giving the reason
    → warn (D3).
  - `checkPrTemplate(body, template) -> missing: string[]` (pure): every heading of the template (P0.09: the five
    headings, then DL-3's fields) is present; a field may say `n/a`. This is the "PR-lint check" P0.09's test names.
  - `checkTrustedBaseIsolation(changedPaths: string[], trustedPatterns: string[], parsed: { parsedPaths: string[],
    findings: GrantFinding[] }) -> { ok: true, touched: boolean } | { ok: false, outside: string[] }` (pure; rule SE-6:
    a PR that changes the trusted base changes nothing else). `trustedPatterns` and `parsedPaths` are read from the
    `# trusted base (SE-6)` section of `.github/CODEOWNERS` (P0.03: the path lines, and its one `# parsed:` line), so
    that file is the one list. **Parser spec (PR #7 review):** the section starts at the line `# trusted base (SE-6)`
    and runs to the end of the file; it must be the last section and contain no blank line. Inside it, a line is a
    path pattern, the one `# parsed:` line, or the one `# trusted functions:` line; any other comment line is ignored.
    A blank line inside the section, a non-comment line after a blank line, a second `# parsed:` or `# trusted
    functions:` line, or a missing or empty section → error (fail closed). A changed path under a parsed path is a trusted-base file when `classifyGrantChanges`
    gives it only `trusted` findings, a feature file when it gives it only `feature` or `neutral` findings, and is put
    in `outside` with reason `mixed_grant_change` when it gives it both (the grants go in their own file and PR). If no
    changed path is a trusted-base file → `{ok: true, touched: false}`. Otherwise every changed path must be a
    trusted-base file, a test of one (`<path>.test.ts` beside it, or a file under `tests/**` whose path contains the
    trusted folder's name, `postgres` for the parsed paths) or documentation (`*.md` inside a trusted folder,
    `docs/human/**`); anything else is listed in `outside` and the check fails. No label or override exists (fail
    closed). A step whose change spans both becomes two steps (SE-6 as ruled 2026-10-04): a kit or other trusted-base
    change is split out just ahead as `<id>k`, a grants change as `<id>g` (one letter, so the id still matches
    `checkCommitMessage`), each its own PR titled with its own id.
  - `classifyGrantChanges` and its spec moved to P0.09e (split 2026-10-05); this step uses it in `change-shape.ts`.
  - `checkPathsMixed(changedPaths: string[], checks: string[]) -> string[]` (pure; SE-6 ruling 2026-10-05, refined
    01:15Z, amended 01:40Z): when a changed path matches a `# checks:` pattern (the CODEOWNERS trusted-base section's
    machine-read line: the `scripts/` check folders, `.github/`, `.githooks/`, `.semgrep/`, `.semgrepignore`,
    `.dependency-cruiser.cjs`; generators and dev tools under `scripts/` are not check paths, narrowed 01:43Z), it returns the changed product paths (`apps/`, `interfaces/`, `domains/`,
    `infrastructure/`, `shared/`, `deployment/`); a non-empty result fails `[SE-6]`. Tests, fixtures, `docs/human`,
    `docs/ai` and repo config such as `renovate.json` ride along. Documentation inside a product folder does not count
    as product, in this check and in trusted-base isolation alike: a regular file (git mode 100644) that is a package's
    `LICENSE`, `LICENSE.md` or `LICENSE.txt`, any `*.md`, or a `package.json` whose diff changes only `license`. A
    symlink is judged by its location. On `pull_request`, CI runs the
    PR's own workflow and guards, so human review of a check PR is the gate. Running the base commit's copy
    (`pull_request_target`) is rejected. The `# checks:` lines of the base and head sections are read as one union, so a
    PR cannot drop a path from the list to escape; neither side having the line exits 1. Root `package.json` is off the
    list (adding a workspace must touch it), so a change to its `check` script is review-only.
  - `checkPerfEvidence(diff: string, body: string) -> missing: boolean` (pure; plan §6.1 Data access, rule PF-1): the
    diff adds a `-- why: speed` line in a migration (P1.11's index rule) and the body's `Performance evidence` field
    is `n/a` or lacks `p50`, `p95` and `p99` → missing (error).
  - `.githooks/commit-msg` (opt-in, enabled with `git config core.hooksPath .githooks` like the existing pre-commit hook):
    runs `checkCommitMessage` on the message file; failure prints the errors and exits 1.
  - CI job `pr-shape` (5 min, `pull_request` only, `permissions: { contents: read, pull-requests: read }`,
    checkout with `fetch-depth: 0`): reads the title, body and labels **only through `env:`** (`PR_TITLE: ${{
    github.event.pull_request.title }}` etc.; never `${{ … }}` inside `run:`, P0.07 rule), then runs
    `node scripts/guards/change-shape.ts` which applies `checkPrTitle` (error), `checkCommitMessage` on each commit
    in `base...head` (error), `measurePrSize` (warn prints `::warning`, fail exits 1), `checkPrTemplate` (error),
    `checkTrustedBaseIsolation` (error, `[SE-6]`) and `checkPerfEvidence` (error, `[PF-1]`).
  - `labels.json` gains `large-pr` and one kind label per change kind, `kind/feature`, `kind/fix`, `kind/refactor`,
    `kind/docs`, `kind/build` (D2: the kind of change rides on a label; lead default for the names). A PR with no kind
    label or more than one → `::warning` only.
  - `required-checks.json` gains `pr-shape`.

Algorithm (`change-shape.ts main`):
  1. Read `PR_TITLE`, `PR_BODY`, `PR_LABELS` (JSON array), `BASE_SHA`, `HEAD_SHA` from the environment. Any missing →
     exit 1 ("not a pull_request event"); never default to passing.
  2. `checkPrTitle(PR_TITLE)`; collect errors.
  3. `git log --format=%B%x00 BASE_SHA..HEAD_SHA` (timeout 30 s); for each message `checkCommitMessage`; collect errors
     with the short sha.
  4. `git diff --numstat BASE_SHA...HEAD_SHA` → `measurePrSize`.
  5. `checkPrTemplate(PR_BODY, template file)`.
  5a. `git diff --name-status BASE_SHA...HEAD_SHA` → changed paths. For the parsed paths read the base and head
      contents with `git show <sha>:<path>` (every base migration, the head's added and changed ones, both sides of
      `grant-matrix.json` and `erasure-registry.json`; a file absent on one side is `null`) → `classifyGrantChanges`. A `git` call
      that fails or times out (30 s) → exit 1, never "no findings". Then `checkTrustedBaseIsolation` with the patterns
      and the `# parsed:` line from `.github/CODEOWNERS`; the section, or its `# parsed:` line, missing or empty → error
      (never "no trusted base, pass"). Each `trusted` finding is printed as `[SE-6] <path>:<line> <reason>: <first 80
      characters of the statement>` so the author sees which statement to split out. `git diff -U0` of
      `infrastructure/postgres/migrations/**` → `checkPerfEvidence`.
  6. Print every finding as one line `[rule] text`; exit 1 if any error or size `fail`, else 0.
  Alex tail (**deferred until protection exists**, decision 41): add `pr-shape` to the ruleset's required checks
  (source GitHub Actions), as in P0.07 step 8; `required-checks.json` still gains it now.

Edge cases and failures:
  - A title or commit message containing `$(…)`, backticks or quotes → read from env, never evaluated
    (`title_never_interpolated`).
  - A fixup commit (`fixup! …`) on the branch → fails the commit check; the author squashes or rewords before review.
  - Renovate's PRs (P0.08) carry no step of their own → this step sets `commitMessagePrefix: "P0.08"` and a capitalised
    `commitMessageAction` ("Update") in `renovate.json`, so a dependency PR reads `P0.08 Update vitest to 5.0.3`
    (the step that owns dependency updates; editor default, Alex may change it in review).
  - The PR is a `[SPIKE]` branch (`spike/*`, rule DL-2) → never merged, so the job still runs and may fail; nothing gates
    on it.
  - Size fails and the label is set without a `Large PR:` reason → still fails.
  - A PR touches a trusted-base file and a route handler → fails `[SE-6]`, naming the route file; the agent splits it.
  - A feature migration that also widens a grant on an existing table → `trusted` finding plus feature files → fails
    `[SE-6]` naming the statement; the agent splits a `<id>g` grants step out ahead of it.
  - A feature PR that creates `app.x`, grants on `app.x` and adds its `grant-matrix.json` row → no `trusted` finding;
    passes. It still needs CODEOWNERS security review, since `/infrastructure/postgres/` stays whole there.
  - `DO $$ … EXECUTE format('GRANT …') $$` or any statement the tokenizer cannot classify → `unclassified`, trusted
    base (fail closed). P1.12's idempotent role creation uses `DO` blocks and lands in its own grants-only PR, so this
    costs nothing there.
  - A grants-only PR (migration with only `trusted` statements, its `grant-matrix.json` rows, `roles.json` (whole path),
    `tests/integration/postgres/**`) → ok, touched.
  - A parser mistake can only err towards `trusted` for unknown input; a statement wrongly listed as `neutral` is a
    guard bug, fixed with a fixture in `grant-parse.test.ts`.
  - The CODEOWNERS trusted-base section is deleted or emptied in the same PR → that PR touches `.github/` and the check
    reads the base branch's section as well; either section missing → error.

Threats: the text and size of changes that reach `main`.
  - E Script injection through a PR title, body, label or commit message → env only, no `${{` in `run:`, no
    `pull_request_target` (`title_never_interpolated`; P0.07 `no_expression_in_run`).
  - T A 2,000-line PR reviewed as a rubber stamp → size fail above 800 without `large-pr` and a reason
    (`size_fails_over_800`, `size_label_needs_reason`).
  - R A subject on `main` that names no step → title and commit checks (`commit_requires_step_id`, `title_checked`).
  - T A trusted-base change hidden inside a large feature PR → trusted-base isolation (`trusted_base_isolated`,
    `trusted_base_list_from_codeowners`).
  - E A grant widened on an existing table, function or schema inside a feature migration → grant parse
    (`grant_parse_widen_existing_fails`, `grant_parse_cases`); an unparseable statement counts as trusted base
    (`grant_parse_unparseable_fails`).

Done when (tests): (`scripts/guards/change-shape.test.ts`; pure functions with fixtures)
  - commit_valid: `P1.07 Enforce exact Origin match in CSRF gate` → ok; with a body after a blank line → ok.
  - commit_requires_step_id: `Enforce exact Origin match` → `subject.no_step_id`.
  - commit_rejects_conventional: `P1.07 fix(csrf): match origin` and `fix(csrf): match origin` → `subject.conventional_prefix`.
  - commit_capital_no_period_lengths: lowercase summary, trailing period, 51 characters after the id, a 73-character
    subject, a missing blank line and a 73-character body line → one named error each; a URL-only long body line → ok.
  - title_checked: the job fails on a bad title with good commits.
  - size_counts_source_only: a numstat with 300 source lines, 900 test lines, a lockfile and a generated file → 300, ok.
  - size_warns_over_400, size_fails_over_800, size_label_needs_reason (label without the `Large PR:` line → fail; with
    it → warn).
  - template_headings_required: a body missing `Why` → `missing = ["Why"]`; a field reading `n/a` → present.
  - title_never_interpolated: `ci.yml`'s `pr-shape` job reads every PR value through `env:` (static check, as P0.07's
    `no_expression_in_run`).
  - hook_runs_check: `.githooks/commit-msg` on a temp message file with a bad subject exits 1, a good one 0.
  - required_check_listed: `pr-shape` is in `required-checks.json` and is a job id in `ci.yml`.
  - trusted_base_isolated (SE-6): changed paths `shared/http/csrf/gate.ts` + `shared/http/csrf/gate.test.ts` → ok,
    touched; `shared/http/csrf/gate.ts` + `interfaces/http/routes/profile.ts` → fail, `outside = ["interfaces/http/routes/profile.ts"]`;
    `infrastructure/postgres/migrations/0042_x.sql` holding `GRANT SELECT ON app.account TO api` (an existing table) +
    `domains/content/x.ts` → fail; the same migration holding only `CREATE TABLE app.x` and its grants + `domains/content/x.ts`
    → ok, not touched; `domains/content/x.ts` alone → ok, not touched; `shared/http/README.md` + `shared/http/csp/build.ts`
    → ok.
  - trusted_base_list_from_codeowners: patterns parsed from a fixture CODEOWNERS equal its `# trusted base (SE-6)`
    section; the real file's section is non-empty, is the last section, and contains `/deployment/edge/`,
    `/shared/lexicons/` and `/interfaces/chat-auth/`; a fixture without the section → error; a fixture with a path
    line after the section (a later section) → error; a fixture with a blank line inside the section → error; a
    fixture with two `# trusted functions:` lines → error.
  - check_pr_alone_ok, check_plus_product_fails, check_plus_docs_and_tests_ok, checks_line_union_of_base_and_head (a
    PR that removes `.semgrep/` from `# checks:` and edits `.semgrep/` plus `domains/` still fails), fixture_is_check_path
    (`checkPathsMixed`, SE-6 ruling 2026-10-05 refined 01:15Z); doc_exemptions_in_both_checks and
    symlink_license_not_exempt (amended 01:40Z); checks_list_complete: every `scripts/` folder a workflow or the root
    `package.json` runs is on the `# checks:` line (01:43Z).
  - perf_evidence_required (PF-1): a diff adding `-- why: speed` with `Performance evidence: n/a` → error; with a
    before-and-after line naming p50, p95 and p99 → ok; `-- why: unique` with `n/a` → ok.
  - planted (agent, recorded in the PR): a scratch PR titled `fix: thing` fails `pr-shape`; closed, branch deleted.

Reuse: `@commitlint/*` → REJECT (built around Conventional Commits, which D2 rejected; a 40-line pure function fits).
  Bootstrap `.githooks/pre-commit` → pattern only. Provisional — for reuse review.
Not in this step: the red-first CI job for bug-fix PRs (rule TE-5, P2, when bug-fix PRs exist); the "Behaviour change"
section requirement when `expect(` lines are removed (rule DL-1; lands with its trigger, the first loosened assertion);
the review-queue cap (D4 is a CLAUDE.md instruction, P0.09).
Diagram: none.

As built (2026-10-05):
  - Files: the grant classifier was split out as P0.09e and merged first. `grant-isolation.test.ts` runs the
    classifier and `checkTrustedBaseIsolation` together on the PRs the `grant_parse_*` tests describe. The wiring
    tests sit in `change-shape-wiring.test.ts` (`title_never_interpolated`, `hook_runs_check`, and
    `job_reads_git_safely`, which runs the job on a throwaway repository); `required_check_listed` and
    `renovate_titles_pass` sit in `scripts/docs/change-shape-config.test.ts`, and the new labels in P0.09b's
    `labels_listed`. The proposed P0.09f was folded back in (ruling 2026-10-05 01:15Z): repo config and tests may ride
    with a check PR, so labels, required checks and Renovate ship here.
  - Workflow: `pr-shape` is its own workflow, `.github/workflows/pr-shape.yml`, with `permissions: {}`, on the
    `pull_request` types opened, synchronize, reopened, edited, labeled and unlabeled, so a retitle or a label change
    re-checks without a push. `ci.yml` is unchanged.
  - Commits: `git log --no-merges`, so the "Merge branch 'main'" commits an owning thread makes are not checked;
    `checkCommitMessage` also passes git's and GitHub's merge subjects, since `git merge` runs the hook. Without a
    step id, only `subject.no_step_id` and `subject.conventional_prefix` are reported. A step id is at most 6
    characters, so the 72-character subject cap never binds before the 50-character summary cap.
  - The trusted-base patterns, `# parsed:` paths, trusted functions and `# checks:` paths are the union of the base and
    head CODEOWNERS sections (`unionTrustedBase`); either section unreadable, a `# parsed:` path the guard cannot read,
    or no `# checks:` line on either side exits 1. Git output is read with `-z`, so a non-ASCII path still matches.
    The template headings come from the base branch's template. A `mixed_grant_change` file counts as touching the
    trusted base. Trusted findings print as `::notice` when the PR passes, and as errors beside the `[SE-6]` failure.
  - Check paths versus product paths: `checkPathsMixed` sits beside `checkTrustedBaseIsolation` in `trusted-base.ts`.
    This PR itself is a check PR (scripts/guards, .github, .githooks) with tests, docs and `renovate.json` riding along.
    Root `package.json` is off the `# checks:` list and stays review-only. The ruling named `guards`, `lint`, `ci`,
    `budgets`, `licence` and `docs`; this PR also lists `scripts/test/` (the root `test` script runs `run.ts`, so
    `checks_list_complete` requires it) and `scripts/workspace/` (its `references.ts` decides the workspace tests and
    P0.13's licence check imports it). A `scripts/` module a check imports is part of that check and sits in a check
    folder (ruling 01:47Z); a dependency-cruiser rule may enforce it later.
  - Documentation exemptions (rulings 2026-10-05 01:31Z and 01:40Z; `isDocumentation` in `trusted-base.ts`): changed
    paths come from `git diff -z --raw`, so each carries its head mode, and only a regular file qualifies. A
    `package.json` counts as licence-only when base and head parse to deep-equal objects once `license` is dropped
    (`node:util` `isDeepStrictEqual`); an unreadable side is not documentation. A file under a `# parsed:` path is
    judged by its grant findings before any exemption. The end-to-end test adds a symlink named `LICENSE`, which the
    job reports as a product path.
  - `renovate.json` also sets `"semanticCommits": "disabled"`: Renovate's `commitMessagePrefix` is replaced by a
    semantic prefix when semantic commits are on (docs.renovatebot.com/configuration-options, read 2026-10-05).
  - Planted check: no scratch branch (agents push only to their own branch). The PR was first opened titled
    `fix: thing`, `pr-shape` failed on it, and the title was then corrected.
  - Alex tail: deferred with the ruleset (decision 41); `required-checks.json` lists `pr-shape` now.

---

### P0.09e — Classify grant changes for the trusted base (split from P0.09c, 2026-10-05)
Tags: [SEC]            Depends on: P0.03 (the CODEOWNERS trusted-base section)            Plan: §9 trusted base (rule SE-6)
Where: `scripts/guards/grant-sql.ts`, `scripts/guards/grant-json.ts`, `scripts/guards/grant-parse.ts`,
  `scripts/guards/grant-parse.test.ts` + SQL and JSON fixtures
Size: ~676 source and test lines as built (one pure module set plus its tests)
Order: letters name steps, not merge order. P0.09e merges BEFORE P0.09c, which depends on it.

Goal: one pure function says, for each changed migration and grant file, whether a change is trusted base, feature
work or neutral, so P0.09c can enforce SE-6's "a trusted-base change changes nothing else".

Inputs: P0.03's CODEOWNERS `# trusted base (SE-6)` section, with its `# parsed:` and `# trusted functions:` lines. No
other step's code.
Outputs (moved unchanged from P0.09c, items 1 to 6; nothing added or removed):
  - `classifyGrantChanges(input: { base: { migrations: {path, sql}[], grantMatrix: string | null, erasureRegistry:
    string | null }, head: { same shape }, changed: { path, status: "A" | "M" | "D" | "R" }[] }) -> GrantFinding[]`
    where `GrantFinding = { path, line, kind: "trusted" | "feature" | "neutral", reason, statement }` (pure, in
    `grant-parse.ts`). It implements rule SE-6's "Enforced by" (engineering rules, as updated after the 2026-10-04
    follow-up ruling; plan §9 at `6275827`) and nothing more: it parses migrations, `grant-matrix.json` and
    `erasure-registry.json`, and fails closed. `roles.json` is not parsed: it is a whole-path trusted-base file.
    1. **Objects this PR creates** are those created by its added migration files and absent from the base branch's
       migrations: tables (`CREATE TABLE` and its columns), columns (`ALTER TABLE … ADD COLUMN`, that column only),
       views (`CREATE [MATERIALIZED] VIEW`), sequences (`CREATE SEQUENCE`, and the one an identity or serial column of a
       new table makes) and functions (`CREATE FUNCTION`, `CREATE PROCEDURE`, SECURITY DEFINER included). A schema is
       never a created object for this purpose, since a schema grant always counts.
    2. The SQL is split into statements by a tokenizer that knows `--` and `/* */` comments, quoted identifiers,
       string literals and dollar quotes. Names are compared schema-qualified and case-folded as Postgres folds them.
    3. **`trusted`**, exactly SE-6's kinds (a–e; f and g implement its `eraseDid` entry and its column grants):
       a. any role statement or role attribute: `CREATE`, `ALTER` or `DROP` `ROLE`, `USER` or `GROUP` (a password or
          other attribute included), and role membership (`GRANT <role> TO …`, `REVOKE <role> FROM …`);
       b. a schema grant: `GRANT` or `REVOKE … ON SCHEMA`, and `… ON ALL … IN SCHEMA`;
       c. on an object the PR does not create: `GRANT` or `REVOKE` on a table, view, sequence, column or function (a
          column-list grant rides only when every listed column is created by the PR; a table-wide grant on an existing
          table is trusted even when the PR adds a column to it); `ALTER DEFAULT PRIVILEGES` (it targets future objects
          of a schema, never one this PR creates, so it is always trusted); `CREATE`, `ALTER` or `DROP POLICY` and
          `ALTER TABLE … ENABLE | DISABLE | FORCE | NO FORCE ROW LEVEL SECURITY`;
       d. a changed or removed `erasure-registry.json` row (rule 6);
       e. any `CREATE OR REPLACE` or `ALTER` of a function or view the PR does not create (SE-6's wording; plan §9 at
          `badf15a`): a new body
          or definition, or an `ALTER` of its `SECURITY`, owner, `search_path` or anything else; definer and invoker
          functions alike, procedures and materialized views included;
       f. creating, replacing, altering or granting on a function named on the CODEOWNERS section's `# trusted
          functions:` line (P0.03: the `eraseDid` family `core.erase_*`, `core.is_erased`, `core.allow_retrack`,
          `core.is_held`, `mod.erase_foreign_did`; the line grows in the trusted-base step that first names a function:
          P1.15 the audit append functions, P4.07k/P4.07h the legal-hold definers), so the SQL of SE-6's function
          families is trusted base even when new. **Fail closed for families without names yet** (column-list ruling,
          plan §9 at `9c54e52`): any `CREATE [OR REPLACE] FUNCTION | PROCEDURE` in schema `audit`, and any `SECURITY
          DEFINER` function in a legal-hold migration (file name containing `legal-hold` or `legal_hold`, or a body that
          names a `legal_hold` table; migrations live in `infrastructure/postgres/migrations/`, P1.01), is `trusted`
          with reason `trusted_family_unnamed`, even when the PR creates it;
       g. `ALTER TABLE … ADD COLUMN` on a table the PR does not create, unless the base `grant-matrix.json` proves the
          new column's inherited grants were already intended: every entry for that table is column-level, or is a
          table-level entry marked `"wholeTable": true` (P1.12: that role is meant to read every column, present and
          future). A table with no matrix entry, a table-level entry without the flag, or an unreadable matrix →
          trusted (fail closed). Setting or clearing `wholeTable` on an existing table's entry is a matrix change on an
          existing object, so trusted by c.
       The same statements on an object the PR creates are `feature`.
    4. **`neutral`**, a closed list of statements that are none of the above: `CREATE TABLE`, `CREATE [UNIQUE] INDEX
       [CONCURRENTLY]`, `CREATE [OR REPLACE] [MATERIALIZED] VIEW` (of a new name), `CREATE [OR REPLACE] FUNCTION |
       PROCEDURE` of a new name not on the `# trusted functions:` line,
       `CREATE TRIGGER`, `CREATE TYPE`, `CREATE DOMAIN`, `CREATE SEQUENCE`, `CREATE SCHEMA`, `ALTER TABLE` (subject to 3g) with only
       `ADD COLUMN`, `ADD CONSTRAINT`, `VALIDATE CONSTRAINT`, `ALTER COLUMN … SET | DROP DEFAULT | NOT NULL`, `DROP
       COLUMN`; `DROP INDEX`, `COMMENT ON`, `INSERT`, `UPDATE`, `DELETE`, `SET ROLE`, `RESET ROLE`, `SET LOCAL` (session
       only; P1.15 builds the audit objects under `SET ROLE audit_owner`), `BEGIN`, `COMMIT`. The list grows only by a
       PR to this guard (`/scripts/guards/`, CODEOWNERS).
    5. **Fail closed:** anything not classified by 3 or 4 is `trusted` with reason `unclassified`: an unknown verb, a
       `DO` block, `EXECUTE` of dynamic SQL, a statement the tokenizer cannot close (an unterminated quote or dollar
       quote), and statements kept off the neutral list on purpose because their effect on access is not a plain
       create (`ALTER TABLE … OWNER TO`, `DROP TABLE`, `DROP FUNCTION`, `DROP VIEW`). A migration file that already exists on
       the base branch and is modified, renamed or deleted cannot be read as a list of new statements, so it is
       `unclassified` too (P1.11 forbids editing a merged migration).
    6. `grant-matrix.json` and `erasure-registry.json` are parsed as JSON on both sides. Matrix: a privilege added,
       removed or changed on an object is `trusted` unless the PR creates the object (then `feature`); any change under
       `roles` (role attributes and membership) or `schemas` (schema grants) is `trusted`, and so is a change to
       `pluginRule`, which is a rule about roles and schemas. Registry (`"<schema>.<table>.<column>": {strategy, …}`): a
       row added for a column the PR creates is `feature`; a changed or removed row is `trusted`; a row added for a
       column that already exists is not one of the riding kinds and is `trusted` (`unclassified`, fail closed). Either
       file failing to parse, or holding an unknown top-level key → `trusted`, `unclassified`.
No caller until P0.09c, which wires it in through `change-shape.ts`. The 2026-10-05 SE-6 ruling narrows items 3 and 4;
see As built below.

Algorithm: as the Outputs above. Threats: a grant smuggled into a feature PR → `trusted` or `unclassified`, never
`feature` (`grant_parse_widen_existing_fails`, `grant_parse_cases`, `grant_parse_unparseable_fails`).
Done when (tests, `grant-parse.test.ts`; moved unchanged from P0.09c):
  - grant_parse_feature_create_and_grant_passes (`grant-parse.test.ts`; SE-6 ruling 2026-10-04): a PR adding
    `0042_x.sql` with `CREATE TABLE app.x (…)`, `GRANT SELECT, INSERT ON app.x TO web`, `CREATE FUNCTION app.f() …
    SECURITY DEFINER`, `GRANT EXECUTE ON FUNCTION app.f() TO web`, `ALTER TABLE app.x ENABLE ROW LEVEL SECURITY`, the
    matching `grant-matrix.json` rows, an `erasure-registry.json` row for a `did` column of `app.x`, and
    `domains/content/x.ts` → no `trusted` finding; isolation ok, not touched. A `CREATE VIEW app.v` and `CREATE SEQUENCE
    app.s` with grants on them → `feature` too.
  - grant_parse_widen_existing_fails: base migrations create `app.account`; the PR adds a migration with
    `GRANT SELECT ON app.account TO api` beside `domains/content/x.ts` → one `trusted` finding naming that statement;
    isolation fails with `outside = ["domains/content/x.ts"]`. The same migration with only its `grant-matrix.json` row
    and `tests/integration/postgres/grants.test.ts` → ok, touched. The same `GRANT` beside `CREATE TABLE app.y` in one
    file → `mixed_grant_change`.
  - grant_parse_unparseable_fails: beside a feature file, a new migration holding (a) `DO $$ BEGIN EXECUTE 'GR' ||
    'ANT SELECT ON app.account TO api'; END $$;`, (b) an unterminated dollar quote, (c) an unknown verb `SECURITY LABEL
    …`, and (d) an `erasure-registry.json` that is not valid JSON → each gives `trusted`, `unclassified`, and the PR
    fails.
  - grant_parse_replace_definer_fails (3e): base migrations create `core.f()` `SECURITY DEFINER`; the PR adds a
    migration with `CREATE OR REPLACE FUNCTION core.f() … SECURITY DEFINER` beside `domains/content/x.ts` → one
    `trusted` finding, isolation fails with `outside = ["domains/content/x.ts"]`; the same migration alone (with its
    tests) → ok, touched.
  - grant_parse_existing_function_or_view_changed (3e), each beside a feature file → trusted, PR fails: `CREATE OR
    REPLACE FUNCTION app.g()` where base has `app.g()` as `SECURITY INVOKER`; `CREATE OR REPLACE VIEW app.v` where base
    has `app.v`; `ALTER FUNCTION app.g() SET search_path = pg_catalog, app`; `ALTER FUNCTION app.g() SECURITY DEFINER`;
    `ALTER VIEW app.v OWNER TO web`. The same five on a function or view the PR creates → neutral.
  - grant_parse_add_column (3g): base `app.account` with a table-level `web` entry marked `wholeTable` → `ADD COLUMN`
    neutral, PR passes with feature code; the same entry without the flag → trusted, PR fails; `app.account` with only
    column-level entries → neutral; a table absent from the matrix → trusted; the PR setting `wholeTable` on
    `app.account`'s existing entry → trusted.
  - grant_parse_cases (one row each): `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO web` → trusted; `CREATE
    ROLE x` → trusted; `GRANT audit_owner TO migrator` → trusted; `GRANT USAGE ON SCHEMA mod TO admin` → trusted;
    `CREATE POLICY p ON app.x` with `app.x` new → feature, existing → trusted; `GRANT SELECT (c) ON app.account TO
    admin` with `c` added by the PR → feature, with `c` existing → trusted; `GRANT SELECT ON app.account` after the PR
    adds a column → trusted; `ALTER ROLE web PASSWORD …` → trusted; `REVOKE ALL ON ALL TABLES IN SCHEMA app FROM
    PUBLIC` → trusted; `CREATE OR REPLACE FUNCTION` of a base function → trusted (3e); `CREATE FUNCTION
    core.erase_x` (new, matching `# trusted functions:`) → trusted (3f); `ALTER TABLE app.x OWNER TO web` →
    `unclassified`; `SET ROLE audit_owner` → neutral; a modified merged migration → `unclassified`; a
    `grant-matrix.json` row for an existing table → trusted, for a new one → feature; a `grant-matrix.json` `schemas`
    entry → trusted; registry: a row added for a new column → feature, a changed `strategy` on an existing row →
    trusted, a removed row → trusted, a row added for an existing column → trusted; any `roles.json` change
    (`passwordFrom` null → a path included) → a trusted-base file by its path; a comment or string containing `GRANT`
    → not a statement.
  - grant_parse_trusted_families (column-list ruling; SE-6's three function families): `CREATE FUNCTION
    audit.append_x()` (new, not on the line) → trusted, `trusted_family_unnamed`; `CREATE FUNCTION
    core.hold_x() … SECURITY DEFINER` in `0050_legal_hold.sql` (new) → trusted; the same function without `SECURITY
    DEFINER` in a migration unrelated to legal hold → neutral; once a fixture line names `audit.append_x`, its
    `CREATE FUNCTION` → trusted by 3f; `CREATE FUNCTION app.f()` (new, plain) → neutral. Each beside
    `domains/content/x.ts` → the PR fails `[SE-6]` for the trusted ones.
  - no_runtime_caller_yet: a static check that only tests import `grant-parse.ts`. P0.09c flips it to "only
    `change-shape.ts` and tests".
  - The done-check line: AI notes updated or none needed.
Not in this step: the isolation check, the CI job, the hook, labels, Renovate and the architecture row (P0.09c).
Reuse: none.
As built (2026-10-05): three files, each one job: `scripts/guards/grant-sql.ts` (tokenizer, statements, the objects a
  migration creates), `grant-json.ts` (rule 6, the two JSON files) and `grant-parse.ts` (rules 3 to 5 and
  `classifyGrantChanges`). Its cases are inline SQL and JSON in `grant-parse.test.ts`, not fixture files.
  - The input also takes `trustedFunctions` (the CODEOWNERS `# trusted functions:` line), so the classifier stays pure.
  - Fail-closed choices beyond the spec, from the adversarial review (`grant_parse_*` tests named after each):
    - a new migration with a byte Postgres reads differently from JavaScript (anything but printable ASCII, tab, LF
      and CRLF: a lone CR ends a `--` comment, U+00A0 is an identifier byte) or a `U&` escape is `unclassified` as a
      whole;
    - an unqualified name is never resolved (search_path is unknown), so whatever depends on it is trusted;
    - `SET LOCAL` is neutral only for `role`, `lock_timeout` and `statement_timeout`; `search_path`, its alias
      `SCHEMA`, and `standard_conforming_strings` change how the SQL is read;
    - `CREATE … IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` never count as created (they may be no-ops on an
      object the parser did not see);
    - a column-list grant with one privilege lacking a column list (`SELECT (c), UPDATE`) is table-wide;
    - `CREATE SCHEMA` is neutral only bare; `ALTER FUNCTION … RENAME | SET SCHEMA` is `unclassified`;
    - matrix and registry findings always name the fixed paths, so a decoy file of the same name cannot take them.
  - SE-6 ruling of 2026-10-05 (engineering-rules.md, SE-6 "Enforced by"), folded in here: `CREATE TRIGGER` or `CREATE
    RULE` on a table the PR does not create, `CREATE TABLE` with `AS`, `PARTITION OF`, `LIKE` or `INHERITS`, any new
    `SECURITY DEFINER` function, an `ALTER` of a new function's or view's owner or security, and a new view without
    `security_invoker = true` (or any materialized view) that names a relation the PR does not create, are trusted
    (`grant_parse_watchers_and_copies`, `grant_parse_views_and_functions_by_rights`). A view's alias reference
    (`a.id`) reads as a relation name and fails closed; `security_invoker` avoids it.
  - `grant-parse.ts` (348 non-blank lines) and its test file are over Biome's 300-line warning: the classifier is one
    ordered sequence of rules, and splitting it further would scatter the verdict constants it shares.
  - Any file under `migrations/` is read as SQL, a README included (it comes out `unclassified`).
  - `no_runtime_caller_yet`: only tests import `grant-parse.ts` until P0.09c flips it (flipped there: `change-shape.ts`).

---

### P0.09d — AI notes vault and the notes guard (added, Alex 2026-10-04 22:11Z)
Tags: — (parallel-safe: touches only `scripts/guards/` and `docs/ai/`)            Depends on: P0.06            Plan: §7 "AI notes" (Alex, 2026-10-04 22:11Z), §8 Phase 0 ("Start `docs/ai/` as the AI notes vault"); `unset-plan/ai-notes/template.md` ("Keeping it maintained")
Where: new `docs/ai/README.md` (the approved template and its rules), `docs/ai/INDEX.md` (generated),
  `docs/ai/notes/{area,reference,pitfall,how-to,handoff}/.gitkeep`, `docs/ai/notes.base`, `docs/ai/.obsidian/graph.json`,
  `docs/ai/.obsidian/.gitignore` (`*`, `!graph.json`, `!.gitignore`); new `scripts/guards/notes.ts`,
  `scripts/guards/notes.test.ts`, `scripts/guards/fixtures/notes/**`
Size: ~200 source lines, ~250 test lines, ~150 lines of docs

Why here (letter suffix): the plan's Phase 0 now starts the vault, and upkeep is enforced by the repo, not by memory.
It needs only P0.06's guard harness (merged), touches no other step's files, and can run in parallel with P0.09–P0.14.
No old 0x40 note is copied (P0.09a is retired); each phase's `.00` step ports what it needs.

Goal: `docs/ai/` is an Obsidian vault (core features only) with the five note types, and a guard in `npm run guards`
(CI and pre-commit) fails on every rule of the template's "Keeping it maintained".

Inputs: P0.06 (`scripts/guards/files.ts`, `Finding`, `report`, the fixture convention); the approved template
  `unset-plan/ai-notes/template.md` and the samples in `unset-plan/ai-notes/sample/` (`INDEX.md`, `notes.base`, notes).
Outputs:
  - The vault skeleton above; `README.md` is the template (header schema, closed lists, body shapes, rules, Obsidian,
    upkeep). `INDEX.md` is generated by the guard (`npm run notes:index`), never hand-edited.
  - `scripts/guards/notes.ts`: `parseNote(path, text) -> Note | Finding[]`; `checkNotes(root, opts: { changedPaths?:
    string[], today: Date }) -> { errors: Finding[], warnings: Finding[] }`; `buildIndex(notes) -> string`. Rules
    (rule names in brackets):
    **fail:**
      1. `[notes-header]` a missing field, or a value outside its closed list (`type`, `status`, `areas`, `importance`);
         `[notes-id]` an `id` that does not match the file name, or a note outside the folder of its `type`;
         `[notes-summary]` a summary over 120 characters; `[notes-tags]` `tags` other than exactly `type` plus the
         `areas` names.
      2. `[notes-link]` a `related` or `replaced_by` that names no note, or a `code:` path that does not exist.
      3. `[notes-index]` the committed `INDEX.md` differs from `buildIndex`.
      4. `[notes-code-moved]` a PR changes a file listed in some note's `code:` and does not touch that note.
         `changedPaths` comes from `git diff --name-only <base>...HEAD` (in CI the `check` job passes `BASE_SHA` through
         `env:`; locally the merge-base with `origin/main`; in pre-commit the staged paths). No base available in CI
         → error (fail closed).
      5. `[notes-handoff-age]` a `handoff` whose `checked` is more than 14 days before `today`.
    **warn (`::warning`, never fails):** a `current` note with `checked` older than 90 days; an area folder that exists
    in the code (the template's area list mapped to folders) with no `notes/area/<name>.md` hub note.
  - `package.json`: `npm run guards` runs it (it is a Vitest file under `scripts/guards/`, like P0.06's guards);
    `"notes:index"` rewrites `INDEX.md`. `.githooks/pre-commit` already runs `npm run guards`.

Algorithm (`checkNotes`):
  1. List `docs/ai/notes/**/*.md` (sorted). Zero notes → still run rule 3 and the warnings (the empty `INDEX.md` must match), and
     the test proves the scan saw its fixture notes (AB-4: a guard proves it examined more than zero items).
  2. Parse each header as YAML between the first two `---` lines; a parse error → `[notes-header]`.
  3. Apply rules 1, 2 and 5 per note; rule 3 over all; rule 4 when `changedPaths` is given; collect warnings.
  4. Print errors and warnings with P0.06's `report()`; any error → the test fails.

Edge cases and failures:
  - A note renames its file without its `id` → `[notes-id]`.
  - Code is deleted that a note names → `[notes-link]` in the same PR; the note is fixed or marked `replaced`.
  - A PR changes a `code:` file and the note is still true → the author bumps `checked`; that touches the note.
  - A secret or personal data in a note → the `secrets` job (P0.07) fails; the guard does not duplicate it.
  - `today` is injected (TE-4: no real clock in a unit test).

Threats: stale or misleading notes steering an agent wrong.
  - T A note that no longer matches the code → `[notes-code-moved]`, `[notes-link]` (`notes_code_moved_fails`).
  - R A hand-edited or stale index → `[notes-index]` (`notes_index_stale_fails`).

Done when (tests): (`scripts/guards/notes.test.ts`; one planted-fault fixture per failure, each failing for its rule
  only, and one good fixture vault passing)
  - notes_header_bad_type, notes_header_missing_field, notes_header_area_not_listed: each → `[notes-header]`.
  - notes_id_mismatch (file `a.md`, `id: b`) and notes_wrong_folder (`type: pitfall` under `reference/`) → `[notes-id]`.
  - notes_summary_121_chars → `[notes-summary]`; 120 → ok.
  - notes_tags_mismatch (`tags` missing an area) → `[notes-tags]`.
  - notes_dead_related, notes_dead_replaced_by, notes_dead_code_path → `[notes-link]`, one each.
  - notes_index_stale_fails: a committed `INDEX.md` missing one note → `[notes-index]`.
  - notes_code_moved_fails: `changedPaths` holding a note's `code:` file and not the note → `[notes-code-moved]`; with
    the note too → ok; CI mode with no base → error.
  - notes_handoff_15_days → `[notes-handoff-age]`; 14 days → ok.
  - notes_warn_checked_91_days and notes_warn_area_without_hub → a warning, test passes.
  - notes_good_vault: the fixture vault → no error; the real `docs/ai/` → no error; the scan counted ≥ 1 fixture note.
  - vault_skeleton: the five type folders, `notes.base`, `.obsidian/graph.json` exist, and `.obsidian/.gitignore`
    ignores everything else in `.obsidian/`.

Reuse: the prototype's Python `vault` helper → REJECT (template: replaced by one TypeScript guard in the repo's
  language). `unset-plan/ai-notes/sample/notes.base` and `INDEX.md` → USE as the starting files. A YAML parser: the one
  P0.06/P0.09b already pin (P0.09b parses `bug.yml`), or Node's own if none is pinned yet; the PR names it. Provisional —
  for reuse review.
Not in this step: any note's content (each step writes its own; each phase's `.00` step ports old notes); the
  `CLAUDE.md` line (P0.09); the PR-template line (P0.09); the `.00` tidy passes (00-README).
Diagram: none.

---

### P0.10 — Secret scanning, push protection, hardware-key 2FA and offline codes, allowed-signers file
Tags: [ALEX] [SEC]            Depends on: P0.03 (repository settings); the runbook PR needs P0.07            Plan: §8 Phase 0 (admin groundwork), §5.7, §10 (trust tree); admin design §6.3
Where: GitHub settings; registrar accounts; Tailscale identity provider; an offline location; repository file
  `docs/human/runbooks/account-security.md` (agent-written checklist, no secrets)
Size: ~90 lines of runbook, ~20 test lines

Goal: every account at the top of the trust tree is protected by a hardware security key with offline recovery codes,
GitHub refuses pushed secrets where the account's plan allows, the owner's roster-signing public key exists in an
allowed-signers file kept outside anything CI delivers, and the runbook says plainly which items are checked and which
are Alex's word.

Inputs: P0.03 done; Alex's two hardware security keys (daily and backup, FIDO2 with PIN, e.g. two YubiKey 5 series).
Outputs:
  - Secret scanning and push protection enabled **if the account's plan offers them for private repositories**;
    otherwise the required `secrets` check (P0.07) is the control, and the runbook says which.
  - Hardware-key 2FA (two keys) and printed recovery codes on: GitHub; the registrar(s) of `unset.sh`, `unset.ac`,
    `0x40.me`, `0x40.space` and the media domain (P0.11); the DNS provider if different; the email account that receives
    GitHub and registrar mail; the Tailscale identity-provider account (used in P1.33). The hosting provider account is
    added when it exists (P1.34 development host, P5.01 production host).
  - The owner's hardware-backed SSH signing keys and an `allowed_signers` file kept offline (USB + paper), not committed
    and on no host yet (P1.33 places it).
  - `docs/human/runbooks/account-security.md`: the checklist below. Each line is either **checked** (with the command and its
    output, or a test) or **attested by Alex (date)**, never just ticked.

Algorithm (the runbook Alex follows):
  1. GitHub → Settings → Password and authentication: register both security keys; download recovery codes, print them,
     store the print with the backup key in a different place from the daily key; remove SMS as a 2FA method.
  2. Repository → Settings → Code security: enable **Secret scanning** and **Push protection** if offered. Not offered
     (private repository without GitHub Secret Protection) → note "not available; CI gitleaks is the control".
  3. For each registrar and the DNS provider: hardware-key 2FA (WebAuthn) with both keys; recovery codes offline;
     registrar lock (client transfer prohibited) on every domain. A registrar offering only TOTP or SMS → stop and tell
     the agent (plan §5.2 requires hardware-key 2FA; P0.11 picks another registrar).
  4. The email account receiving these mails: hardware-key 2FA, recovery codes offline.
  5. The Tailscale identity-provider account: hardware-key 2FA.
  6. SSH signing keys: `ssh-keygen -t ed25519-sk -O resident -O verify-required -O application=ssh:unset-roster
     -f ~/.ssh/unset_roster_sk` with the daily key; repeat with the backup key (second file). Write both public keys into
     `allowed_signers` as `alex@unset.sh namespaces="unset-roster" sk-ssh-ed25519@openssh.com AAAA…`. Test:
     `echo test > t; ssh-keygen -Y sign -f ~/.ssh/unset_roster_sk -n unset-roster t;
     ssh-keygen -Y verify -f allowed_signers -I alex@unset.sh -n unset-roster -s t.sig < t` → "Good".
  7. Copy `allowed_signers` (public material only) to two offline places. Tell the agent which services are done,
     whether step 2 was available, and both fingerprints (`ssh-keygen -lf`).
  8. The agent writes the runbook (by PR, after P0.07) and runs the checks it can.

Edge cases and failures:
  - A key is lost before the backup is registered → stop; re-run step 1 with a new pair.
  - A service supports only one security key → register the daily key, keep its recovery codes with the backup key,
    record the gap in the runbook.
  - Push protection unavailable → not a blocker (P0.14 relies on the required `secrets` check).

Threats: the accounts at the top of the trust tree (GitHub, registrars, DNS, email, Tailscale identity) and the
  roster-signing key.
  - S Account takeover by phishing or SIM swap → hardware-key 2FA with two keys, SMS removed (accepted as Alex's
    attestation: `attested_items_labelled`).
  - T A roster signed by anyone but the owner → hardware-backed `-sk` signing keys and an offline `allowed_signers`
    file (`signer_fingerprints_recorded`).
  - I A secret pushed to the repository → push protection where the plan offers it, else the required `secrets` check
    (`push_protection_state`).
  - D A lost key locks the owner out → a backup key and offline recovery codes (attested, `attested_items_labelled`).
  - R An item claimed but not done → every checklist line is either checked by a command or attested with a date
    (`attested_items_labelled`).

Done when (tests):
  - push_protection_state (checked): `gh api repos/…` → `security_and_analysis.secret_scanning.status` and
    `secret_scanning_push_protection.status` are `enabled`, or the runbook says "not available".
  - signer_fingerprints_recorded (checked by `scripts/docs/docs.test.ts`): the runbook lists two `SHA256:`
    fingerprints, different from each other.
  - attested_items_labelled (checked by the same test): every checklist line ends in either `checked: <command or test>`
    or `attested by Alex (YYYY-MM-DD)`. Attested, not machine-verifiable: GitHub 2FA with two keys, registrar and email
    2FA, printed recovery codes, where each copy is kept.
  - runbook_merged: the PR passes every required check.

Reuse: admin design §6.3 (roster signing with `ssh-keygen -Y sign -n unset-roster`) → USE as the design. Provisional —
for reuse review.
Not in this step: placing `allowed_signers` on a host (P1.33); the roster itself (P3.16/P3.18); keys (P0.12).
Diagram: none.

---

### P0.11 — Domains: registration, DNSSEC, CAA and parked records, HSTS plan, reserved-label list
Tags: [ALEX]            Depends on: Alex part — none (day one); agent PR part — P0.04, P0.07            Plan: §5.2 (domains, handle-domain rules), §11 Q1, §8 Phase 0 and Phase 1 ("Register `unset.ac`")
Where: registrar and DNS provider (Alex); repository files `docs/human/domains.md`, `deployment/reserved-labels.txt`,
  `deployment/reserved-labels.test.ts` (agent, by PR)
Size: ~45 lines of data, ~100 lines of docs, ~50 test lines

Goal: every domain the product will use is registered, locked and DNSSEC-signed; domains with no service yet cannot get
a certificate or be used to send mail; look-alikes are held; and the handle reserved-label list exists as data that
`pds-admin` will enforce.

Inputs: Q1 decisions: app `unset.sh`, PDS `unset.ac` (production, Phase 5) and `0x40.space` (development, Phase 1),
  handles `0x40.me`, a cookie-less throwaway media domain (example `unsetcdn.net`).
Outputs:
  - Registered (Alex): the media domain; `unset.ac` (the plan says Phase 1; registering now removes a later dependency);
    look-alikes Alex chooses from the agent's candidate list. Confirmed held: `unset.sh`, `0x40.me`, `0x40.space`.
  - Record sets:
      **Parked** (every domain with no service of ours yet: `unset.sh` until P1.28, `unset.ac` until P5.02, the media
      domain until it serves, every look-alike): CAA `0 issue ";"`, `0 issuewild ";"`, `0 iodef
      "mailto:security@unset.sh"`; null MX `0 .` (RFC 7505); SPF TXT `v=spf1 -all`; DMARC TXT at `_dmarc` `v=DMARC1; p=reject;`; no A/AAAA.
      The step that first serves a domain replaces its parked CAA with the serving set (P1.28 for `unset.sh`, P1.34 for
      the development PDS, P5.02 for `unset.ac`; see Notes).
      **Serving** (a domain that serves today; at Phase 0 only the prototype's `0x40.*` domains may): existing records
      unchanged; CAA added only after checking the current certificate's issuer (`openssl s_client … | openssl x509
      -issuer`): `0 issue "<that CA>"`, `0 issuewild ";"` except `0x40.me` (`0 issuewild "<that CA>"`, wildcard handle
      certificate), `0 iodef "mailto:security@unset.sh"`. A CAA that excludes the current issuer would break renewal.
      `accounturi=` (RFC 8657) is added when our ACME account exists (P1.28/P1.33).
  - `docs/human/domains.md`: one row per domain: purpose, registrar, DNS host, record set (parked or serving), DNSSEC (DS
    submitted, date), registrar lock, renewal date and auto-renew, who has access.
  - Real mail exists behind **`security@unset.sh`** (as built, 2026-10-04; Alex chose this address for `SECURITY.md`,
    P0.09, and it is the CAA `iodef` target above). So `unset.sh` is not mail-parked: its MX, SPF and DMARC are the
    receiving set for that mailbox (its CAA stays parked until P1.28), and `docs/human/domains.md` records the mail host.
    `records_match_set` checks `unset.sh` against that receiving set.
  - `deployment/reserved-labels.txt`: one lowercase label per line, `#` comments allowed. Minimum set (plan §5.2): `www`,
    `api`, `admin`, `account`, `mail`, `mta-sts`, `autoconfig`, `status`, plus `_*` (any label starting with an
    underscore). Proposed additions for Alex to accept or strike in the PR: `autodiscover`, `smtp`, `imap`, `pop`, `ns1`,
    `ns2`, `chat`, `login`, `auth`, `oauth`, `support`, `help`, `security`, `abuse`, `postmaster`, `hostmaster`,
    `webmaster`, `root`, `pds`, `media`, `cdn`, `static`, `assets`, `unset`, `0x40`, `bsky`, `atproto`, `localhost`,
    `int`, and the pattern line `xn--*` (punycode labels, homograph handles).
  - HSTS plan: `Strict-Transport-Security: max-age=63072000; includeSubDomains` served by the edge (P1.28); preload not
    submitted (hard to undo; Alex decides later).

Algorithm (Alex's checklist, prepared by the agent with the candidate lists filled in):
  1. Pick a registrar for `unset.ac` that supports DNSSEC DS submission for `.ac` and hardware-key 2FA (`.ac` is not on
     Cloudflare Registrar; plan §5.2). None found → stop and tell the agent; the agent researches two candidates.
  2. Register `unset.ac`, the media domain and the chosen look-alikes. Auto-renew on; registrar lock on; WHOIS privacy on.
  3. Enable DNSSEC at the DNS host; submit the DS record at the registrar; wait until a validating resolver shows the
     `ad` flag (`dig +dnssec @1.1.1.1 <domain> SOA`).
  4. Apply the parked set to each parked domain, the serving CAA to serving domains. Never publish anything under
     `int.unset.sh` (admin design §5.1).
  5. Tell the agent the registrars and DS dates. The agent opens the PR with `docs/human/domains.md`, the reserved list and its
     test, and runs the checks below.
  6. Alex strikes or accepts the proposed labels in review, and approves.

Edge cases and failures:
  - The media domain is same-site with the PDS or app → rejected (separate registrable domain, plan §5.2).
  - DNSSEC breaks resolution (wrong DS) → remove the DS at the registrar first, then fix; never leave a broken chain.
  - A look-alike is taken → `docs/human/domains.md` row "held by third party"; no action.
  - The registry has no RDAP service (possible for `.ac`) → `registrar_lock` is attested by Alex for that domain, with
    the registrar's screen text pasted.
  - Existing `*.0x40.me` handles from the prototype → unchanged here; L.01 retires them.

Done when (tests):
  - reserved_labels_format (`deployment/reserved-labels.test.ts`): every non-comment line matches
    `^(_\*|xn--\*|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)$`; the eight plan labels and `_*` present; no duplicates.
  - dnssec_validates (checked): `dig +dnssec @1.1.1.1 <domain> SOA` → `ad` flag, and `dig DS <domain> @<parent ns>`
    returns a record, for each domain; outputs in the PR.
  - records_match_set (checked): `dig CAA`, `dig MX`, `dig TXT`, `dig TXT _dmarc.<domain>` → exactly the parked or
    serving set named in `docs/human/domains.md`.
  - registrar_lock (checked): RDAP (`curl -s https://rdap.org/domain/<domain>`) `status` contains
    `client transfer prohibited`, or attested per the edge case.
  - domains_doc_complete: `docs/human/domains.md` has one row per domain with no empty cell.

Reuse: prototype review 04 §6 (domain coupling list) → LESSON. Provisional — for reuse review.
Not in this step: DNS records for services (P1.28, P1.33, P1.34, P1.35); `_lexicon` TXT (P1.35); `mta-sts`/`autoconfig`
placeholders on the PDS (P1.34); enforcement in `pds-admin` (P2.09).
Diagram: none.

---

### P0.12 — Offline key ceremony and the key inventory
Tags: [ALEX] [SEC]            Depends on: ceremony — P0.10 (hardware keys); agent PR part — P0.04, P0.07            Plan: §2 rule 22, §5.3 (lexicon authority), §5.8 and decision 21 (legal-hold key), §10; note `pds-key-custody-and-disaster-recovery`
Where: an offline machine (Alex); repository files `docs/human/runbooks/keys.md` and `docs/human/runbooks/keys.test.ts` (agent, by
  PR, public material only)
Size: ~180 lines of runbook, ~80 test lines

Goal: every long-lived key that later steps say "comes from P0.12" exists, with its private half only offline, two
tested copies in two places, its public half recorded in one inventory, and a restore check proving each copy gives
back the recorded public key. Custody follows P0-A4 (answered by Alex 2026-10-03 11:45Z): keys opened yearly or more
(K2 legal hold, K3 backups, K4 escrow) can be opened only with one of the two hardware keys; the rarely used recovery
keys (K1, K1b and the PDS recovery and rotation keys) stay offline on paper and in a passphrase-locked file.

Inputs: two hardware security keys (P0.10; PIV-capable, e.g. YubiKey 5 series) and the password manager they protect; a
  laptop that boots a live Linux image with networking physically off; three USB sticks; paper and pen (or steel
  plates); pinned releases, each with its published checksum: `goat` (now at `github.com/bluesky-social/goat`), `age`
  and `age-keygen` (`github.com/FiloSottile/age`), `age-plugin-yubikey` (`github.com/str4d/age-plugin-yubikey`).
Outputs:
  - Keys made in this ceremony (all **required**):
      **K1 lexicon-authority rotation key** — K-256 (`goat key generate --type K-256`; `goat`'s default is P-256, so the
      flag matters). Public `did:key:zQ3s…`. P1.35 puts it **first** in the authority DID's `rotationKeys`, so the
      account survives the development PDS (plan §8 Phase 1).
      **K1b lexicon-authority backup rotation key** — K-256, made the same way (P1b-A4, answered by Alex 2026-10-03
      11:48Z: two keys). P1.35 adds it at index 1 straight after the account is created, in a PLC operation signed
      by K1. Stored apart from K1 (K1's paper and file in place 1, K1b's in place 2, and the reverse for the second
      copies), so one lost place leaves one usable key.
      **K2 legal-hold identity** — `age` X25519 (`age-keygen`). Public recipient `age1…`. Used to seal the per-upload
      transmission buffer and held records (P1.14a `sealTo`; video buffer P4.03, legal hold P4.07, image buffer and
      image hold entry point P5.07b; editor resolutions 2 and 3). The private identity is opened only with a hardware
      key (P0-A4) on the owner's device for a hold export (P4.07); no server ever holds it.
      **K3 backup-data identity** — `age` X25519. Recipient used by P1.34 (development PDS backups) and P5.04.
      **K4 escrow identity** — `age` X25519. Recipient used by P5.05.
  - Inventory rows for keys made elsewhere with this same runbook (so one table lists every key):
      production PDS recovery key and PLC rotation key — **generated at P5.02** (the production PDS is deferred to
      Phase 5, decision 20; the rotation key's hex form and its conversion script live there);
      development PDS recovery key — generated at P1.34;
      Tailnet Lock disablement secrets — **generated at P1.33** (online, by `tailscale lock init`). Custody (P1.32 Q2,
      answered by Alex 2026-10-03 11:52Z): Alex only, two sealed offline copies, one in place 1 and one in place 2;
      no copy with Tailscale support.
  - `docs/human/runbooks/keys.md`: the **key inventory**, one row per key:
    `id | key | purpose | algorithm | made in (step, date) | public part | copies and places | used by (steps) |
    restore verified (date: paper, USB 2, USB 3) | rotation or revocation procedure`, followed by the ceremony runbook,
    the use procedures (PLC recovery within 72 hours of a bad rotation-key operation; replacing a rotation key;
    tombstoning a deleted account's DID, admin design §8; opening a legal hold; restoring a backup), and the dry-run
    record. Place names only ("home safe", "bank box"); never key material.
  - Custody (P0-A4, answered by Alex 2026-10-03 11:45Z), in two classes:
    - **Hardware-key class: K2, K3, K4** (opened yearly or more). Each hardware key carries its own
      `age-plugin-yubikey` identity, generated on the key and not exportable (Y1 on the daily key, Y2 on the backup
      key; PIN and touch required). Each X25519 secret file is encrypted to both (`age -r <Y1> -r <Y2>`) and stored on
      USB 2 (place 1) and USB 3 (place 2); either hardware key opens either copy. There is no paper copy and no
      passphrase for this class. Servers still encrypt to the plain `age1…` recipients (P1.14a refuses plugin
      recipients); the hardware keys protect the identity files at rest.
    - **Recovery class: K1, K1b, and the PDS recovery and rotation keys made at P1.34 and P5.02** (rarely used). Each
      private key is written on paper and stored as an `age -p` passphrase-encrypted file on USB 2 and USB 3; the
      passphrase lives in the password manager (protected by the hardware keys) and in a sealed envelope in place 2.
      Paper A + USB 2 → place 1; paper B + USB 3 → place 2.

Algorithm (the ceremony Alex follows; the agent writes it into `keys.md` first, and Alex follows that text):
  1. On a networked machine: download the live image, `goat`, `age`; verify each checksum against the published value
     (a mismatch → stop); copy them and the checksums to USB 1.
  2. Dry run on the offline machine with throwaway keys: steps 3–9 end to end, then wipe. The exact command lines for the
     pinned versions are confirmed here and written into `keys.md`; where a command differs from this book, `keys.md`
     wins and the agent records the difference.
  3. Boot the offline machine from the live image with Wi-Fi and Ethernet physically off. `ip link` shows no interface
     up other than `lo` → else stop. Set `HISTFILE=/dev/null`. Verify the tool checksums again from USB 1.
  4. K1 and K1b: `goat key generate --type K-256`, once each → note the secret key (multibase, 48 characters starting
     `z3vL`) and the public `did:key`. Write each secret key on paper twice, character-checked.
  5. Hardware-key identities: with each hardware key in turn, `age-plugin-yubikey --generate` (PIN policy once, touch
     policy always) → note the public `age1yubikey1…` recipient (Y1, Y2). A hardware key without PIV support → stop.
     K2, K3, K4: `age-keygen -o k<n>.txt` → the file holds `AGE-SECRET-KEY-1…` and prints the public `age1…`
     recipient. No paper copy.
  6. Encrypt each secret to USB 2 and to USB 3: K2–K4 with `age -r <Y1> -r <Y2> -o <usb>/k<n>.age k<n>.txt`; K1 and
     K1b with `age -p -o <usb>/k<n>.age k<n>.txt` (a text file holding the multibase string). Delete the plaintext
     `k<n>.txt` files.
  7. **Restore check**, per key, on the offline machine:
       K1, K1b: decrypt the USB 2 copy and the USB 3 copy with the passphrase, and type the paper copy back in by hand;
         for each of the three, `goat key inspect <multibase>` → prints `Public (DID Key): …` equal to the step 4 value;
       K2–K4: decrypt the USB 2 copy and the USB 3 copy once with each hardware key (`age -d -i <identity stub from
         age-plugin-yubikey --identity>`, four decryptions per key); each → `age-keygen -y` prints the recipient equal
         to the step 5 value.
     Any mismatch → that copy is bad: redo it (rewrite the paper, re-encrypt the USB) and re-check. Base58 has no
     checksum, so a paper typo in K1 or K1b shows up only as a different `did:key`; this step is what catches it.
  8. Record on paper the public values (K1, K1b, Y1, Y2, K2–K4) and the date of the restore check. Power off; the live
     session leaves nothing on disk.
  9. Store per the custody classes above. Give the agent the public values and the restore date.
  10. The agent opens the PR with the inventory and the test; Alex reviews the public values character by character
      against his paper record before approving.

Edge cases and failures:
  - A networked machine touched a private key → that key is burned; generate a new one; record it in the inventory.
  - A tool checksum does not match → stop before step 3; download again from the official release page.
  - `goat` changes its output format → the dry run catches it; `keys.md` records the confirmed commands.
  - Both hardware keys lost or broken → K2–K4 can never be opened again (no paper copy, by design): held records,
    buffers and backups sealed to them are lost. That is why the two keys are kept in different places (P0.10); one
    lost hardware key → buy a replacement, run steps 5–7 again for K2–K4 with the remaining key and the new one (new
    Y recipient, same K2–K4 secrets), and destroy the old USB copies.
  - K2 is lost (both USB copies) → held records and buffers sealed to it can never be opened; that is the reason for
    two places and the restore check; rotation procedure: new identity, new recipient in config, old holds stay sealed.
  - The passphrase holder is unavailable (recovery class only) → the sealed envelope in place 2.
  - K1 is needed online (a PLC operation for the authority DID) → signed on the offline machine; the signed operation is
    carried out on USB 1 (a later step, P1.35, gives the commands).

Threats: long-lived private keys leaving the offline machine.
  - I A private key reaches a networked host or the repository → generated offline with networking physically off;
    only public parts are committed (`no_private_material_in_repo`).
  - D One lost copy loses the DID's recovery or the legal-hold records → two tested copies in two places, restored
    against the recorded public key (`key_inventory_complete`).
  - S A yearly-use key is opened without an owner → K2–K4 open only with a hardware key, no paper copy or passphrase
    (`no_paper_for_hardware_class`).
  - T A wrong public key is recorded → format checks and the restore check (`public_keys_format`,
    `key_inventory_complete`).

Done when (tests): (`docs/human/runbooks/keys.test.ts` parses the inventory table)
  - key_inventory_complete: rows K1, K1b, K2, K3, K4, Y1 and Y2 exist; each has a public part, a "made in" date, two
    places (Y1 and Y2: the place where that hardware key is kept), a custody class (`hardware-key` for K2–K4,
    `recovery` for K1 and K1b), and at least one "used by" step id that exists in `01-outline.md`; rows for the P1.33,
    P1.34 and P5.02 keys exist and say where they are generated.
  - public_keys_format: K1 and K1b match `^did:key:zQ3s[1-9A-HJ-NP-Za-km-z]{44}$` (K-256 multicodec); K2–K4 match
    `^age1[02-9ac-hj-np-z]{58}$`; Y1 and Y2 start with `age1yubikey1`; all differ.
  - restore_verified (**attested**): K1 and K1b carry a date and three ticks (paper, USB 2, USB 3); K2–K4 carry a date
    and four ticks (USB 2 and USB 3, each with Y1 and with Y2); the test checks the columns are filled; the truth of it
    is Alex's word.
  - no_paper_for_hardware_class: K2–K4 rows list no paper copy and no passphrase.
  - no_private_material_in_repo: the whole repository has no match for `\bz(?:3vL|42t|42u)[1-9A-HJ-NP-Za-km-z]{44}\b`,
    `AGE-SECRET-KEY-1`, `AGE-PLUGIN-`, or a bare 64-hex string not preceded by `sha256:` (a `did:key:` value and a
    `sha256:<hex>` checksum pass); the same patterns are gitleaks rules (P0.07), so the `secrets` job enforces it too.
  - runbook_merged: the PR passes every required check.

Reuse: prototype note `pds-key-custody-and-disaster-recovery` (`/home/claude/0x40/.claude/notes/research/
pds-key-custody-and-disaster-recovery.md`) → LESSON (the recovery key is stamped at account creation; the rotation key
must not share the data backup bundle). PDS installer `openssl ecparam … | xxd` key generation (`ref/pds/installer.sh:16`)
→ LESSON for P5.02's hex form. `goat`, `age` → USE (official tools of atproto and age; pinned releases with checksums).
Provisional — for reuse review.
Not in this step: production PDS keys (P5.02); putting recipients into config (P1.14a, P1.34); PLC operations (P1.35);
Tailnet Lock (P1.33); the Ozone labeler key (P5.07); Matrix signing keys (Phase 6).
Diagram:
```mermaid
flowchart LR
  OFF["offline machine<br/>(no network)"] -->|"K1/K1b: paper A + USB 2 (age -p)<br/>K2–K4: USB 2 (to Y1+Y2)"| PL1["place 1"]
  OFF -->|"K1/K1b: paper B + USB 3 (age -p)<br/>K2–K4: USB 3 (to Y1+Y2)"| PL2["place 2"]
  OFF -->|"restore check: 3 copies → same public key"| OFF
  OFF -->|"public did:key / age1 recipients only"| DOC["docs/human/runbooks/keys.md inventory"]
  DOC -->|"K1"| A["P1.35 authority rotationKeys[0]"]
  DOC -->|"K2"| H["P1.14a / P4.03 / P4.07 / P5.07b seal to recipient"]
  DOC -->|"K3, K4"| B["P1.34, P5.04, P5.05 backups and escrow"]
```

---

### P0.13 — Licence decision gates the first public commit
Tags: [STOP] (answered 2026-10-03)            Depends on: the question — none; the ADR PR — P0.04, P0.07            Plan: §11 Q12, §8 Phase 0 ("Decide the licence"); launch gate L.05
Where: root `LICENSE`, a `LICENSE` file in each MIT package, `README.md`, every `package.json` `license`, ADR,
  `scripts/licence/`
Size: ~40 source lines, ~60 test lines

**Answered by Alex 2026-10-03 11:50Z (#54, P0.13 = L.05):** AGPL-3.0-only for the apps; MIT for the small building
blocks and for the `sh.unset.*` lexicon (record-type) files. This also settles P0-A6 (#7): the lexicons are published
under MIT by P1.35. The repository still stays private until launch; L.05 only re-checks this choice before launch.

Goal: record the licence decision and make every package carry its own licence before the repository is ever made
public; until launch the repository stays private and every other step continues.

Inputs: plan §11 Q12; Alex's answer above; bootstrap `LICENSE` (AGPL-3.0 text) and `package.json`
  (`"license": "AGPL-3.0-only"`).
Outputs: ADR `docs/human/decisions/000N-licence.md` (the answer, its date, and the MIT scope: **every package under
  `shared/`** (lexicons, ui, config, errors, i18n and any later generic helper), decision 27 as amended by decision 34
  A6 and plan §8 Phase 0; `infrastructure/net-guard` is AGPL like everything outside `shared/` (decision 34; `shared/http` and
  `shared/admin-envelope` are MIT with the rest of `shared/`); a new folder
  outside `shared/` is AGPL unless the ADR is amended); licence files: the root `LICENSE` stays AGPL-3.0 and covers
  everything outside `shared/`; a root `LICENSE-MIT` (plan §8 Phase 0) plus a `LICENSE` (MIT text, copyright line from
  the ADR) in each `shared/*` package, whose `package.json` says `"license": "MIT"`; every other `package.json` says `"license": "AGPL-3.0-only"`; `README.md`'s licence line names both;
  `scripts/licence/check.ts` (licence compatibility over production dependencies, per package: an MIT package may
  depend only on permissive licences, never on an AGPL workspace package).

The question for Alex (asked and answered; kept for the record):
  "Which licence should unset.sh's own code carry when the repository becomes public? Nothing becomes public until you
  answer; building continues meanwhile. Context: much of the code will be written by AI agents, and how far
  AI-authored code is protected by copyright is unsettled, which affects how enforceable any licence, copyleft
  especially, would be. That is information, not a reason to choose differently."
  Options:
  1. **AGPL-3.0-only (plan's recommendation, current placeholder).** Anyone running a modified copy as a service must
     publish their changes. Protects against a closed hosted fork. Some companies avoid AGPL code, which limits reuse of
     our packages (e.g. `net-guard`) by others.
  2. **MIT or Apache-2.0.** Maximum reuse; anyone may run a closed fork. Apache-2.0 adds an explicit patent grant.
  3. **AGPL for the apps, MIT or Apache-2.0 for the small packages** (`net-guard`, `plugin-api`, `lexicons`). Reuse of
     the building blocks, protection for the product. One more line per `package.json`.
  Recommendation: option 1 now, revisited before launch (plan §11 Q12).
  Follow-ups named in the same message, not decided now: a CLA or DCO when outside contributions open; the licence of
  the `sh.unset.*` lexicon schemas, which P1.35 publishes in Phase 1 (P0-A6).

Algorithm:
  1. (Done: the question was posted through the coordinator and Alex answered option 3, as above.)
  2. Until launch: no step may change repository visibility, publish a package, or push to a public remote; the one
     exception is P1.35 publishing the lexicon schemas (MIT) to the authority account. At every phase exit the agent
     checks `gh repo view --json visibility` = PRIVATE.
  3. Write the ADR. Write `scripts/licence/check.ts`: for each workspace package, run `npm ls --all --json --long
     --omit=dev` from it; collect each dependency's `license` field; compare against the allowed list for that
     package's licence (in the ADR); print conflicts; exit 1 on any conflict or any package with no licence field. No
     `npx` tool (its unpinned tree would run with install scripts).
  4. One PR adding the MIT packages' `LICENSE` files and setting every `package.json` `license` field, with the check's
     output. A file named exactly `LICENSE`, `LICENSE.md` or `LICENSE.txt` at a package root counts as documentation in
     the SE-6 isolation check (ruling 2026-10-05), so the MIT `LICENSE` files in `shared/*` ride in one PR with the
     `package.json` `license` fields. `scripts/licence/` is a check path, but the documentation exemptions (LICENSE
     files, `*.md`, license-only `package.json` diffs) let the PR stay one: see SE-6 as amended 01:40Z.
  5. A conflict → stop and ask Alex with the dependency named.

Edge cases and failures:
  - Someone wants the repository public before launch → not allowed by the plan (§8 Phase 0); the agent says so and
    waits.
  - A dependency has an SPDX expression (`MIT OR Apache-2.0`) → allowed if any alternative is on the list.
  - A dependency has no `license` field → a finding; resolved by reading its LICENSE file and recording it in the ADR.

Done when (tests):
  - decision_recorded: ADR merged naming both licences, the MIT package list and the date.
  - files_consistent (Vitest): every package on the ADR's MIT list has `"license": "MIT"` and its own `LICENSE`
    starting with "MIT License"; the root and every other workspace `package.json` says `AGPL-3.0-only`; the root
    `LICENSE` starts with the AGPL-3.0 title line.
  - mit_package_no_agpl_dependency (Vitest): a fixture MIT package depending on an AGPL workspace package → 1 conflict.
  - licence_check_logic (Vitest): `check` over an in-memory tree with one GPL-2.0-only package under option 2 → 1
    conflict; `MIT OR Apache-2.0` → 0; missing field → 1.
  - still_private_until_launch: at each phase exit, `gh repo view --json visibility` = PRIVATE.

Reuse: `license-checker-rseidelsohn` via `npx` → REJECT (F20). Provisional — for reuse review.
Not in this step: the pre-launch re-check (L.05); CodeQL on publication day (plan §6.1).
Diagram: none.

As built (2026-10-05):
  - ADR 0012 records the licence; the `"license"` fields were already set (bootstrap and P1.01), so the PR adds the
    five `shared/*/LICENSE` files (config, errors, http, log, ui; byte copies of `LICENSE-MIT`) and touches no
    `package.json`. A package-root LICENSE file counts as documentation in both SE-6 checks (ruling 2026-10-05
    01:31Z, built in P0.09c), so the check path `scripts/licence/` and the `shared/*/LICENSE` files ride in one PR.
  - `scripts/licence/check.ts` reuses `findWorkspaces` from `scripts/workspace/references.ts` and also checks the root
    package (`npm ls --workspaces=false`); the allowed lists are in the ADR and the code. `npm ls --long` puts each
    package's manifest fields, `license` included, on its JSON node; a deduped copy carries them but not its children
    (npm 11.19.1, `lib/commands/ls.js` `getJsonOutputItem` and `augmentNodesWithMetadata`, bundled with Node
    26.10.0), so every copy is walked. An optional dependency that is not installed (`{}`) is skipped.
  - No separate CI job: the Vitest test `repository_has_no_conflicts` runs the real check over the installed tree,
    so CI's `check` job already runs it, and `scripts/licence/` is on the CODEOWNERS `# checks:` line.
  - Extra tests from the adversarial review: `spdx_expressions` (AND, OR, parentheses, `WITH` only for a listed
    exception, fail-closed parsing), `deduped_subtree_still_checked`, `optional_peer_not_installed_skipped`.
  - Visibility checked at build time: `gh api repos/Undefined6799/unset --jq .visibility` = private.

---

### P0.14 — Phase 0 exit: planted faults are blocked, and only Alex's approval merges
Tags: [ALEX] (tail: drill D approval and merge)            Depends on: P0.03, P0.07, P0.08, P0.10            Plan: §8 Phase 0 exit
Where: four throwaway branches and PRs; `docs/human/drills/phase-0-exit.md` (agent, by PR)
Size: 0 source lines, ~60 lines of drill record

Goal: prove on GitHub itself that each planted fault fails its required check, that the controls that exist without
branch protection are in place, and that CI is green on a clean `main`.

**Decision 41 (editor pass, 2026-10-04 evening).** With no ruleset possible on the private free plan, the drills that
need protection ("direct push refused", "a green PR without approval cannot merge", and so `BLOCKED`, `--admin`,
self-approval, dismiss-stale and the signed squash commit) are marked **waiting until protection exists**: they run the
day the decision-40 ruleset is applied (P0.03 step 1), and the launch gate's L.04 requires it. Drill D is replaced now
by checks of what exists (step 6 below). Under decision 40 the ruleset needs no approval, so drill D's approval steps
6a–6f are dropped for good; 6b–6c become "an unprotected merge is refused" once protection exists.

Inputs: P0.03 ruleset, P0.07 required checks (set), P0.08 merged (so all guards exist), P0.10 push-protection state.
Outputs: `docs/human/drills/phase-0-exit.md` recording, per drill: branch, PR number, the check that failed or the refusal
  text, `mergeStateStatus`, `reviewDecision`, run URL, date; and the clean-`main` run URL. The record never contains a
  planted value (a full-history scan would then fail forever); it names the drill and the rule instead.

Algorithm:
  1. Assert `main` CI is green on its latest commit (`gh run list --branch main --workflow ci.yml --limit 1` →
     `success`). Not green → stop; the exit cannot be claimed on a red `main`.
  2. Fault A, secret: branch `claude/p0-14-drill-secret` from `origin/main`; add `docs/human/drills/tmp-secret.md` with
     `UNSET_CANARY_` + 32 random alphanumerics and, on a second line, a PEM block `-----BEGIN PRIVATE KEY-----` with 64
     random base64 characters and the END line (random bytes, not a key). Push.
     a. Push rejected by push protection → record "blocked at push" (pass for A); go to fault B.
     b. Else open the PR (ready for review, not draft, so the ruleset evaluates it like a real PR). Wait for checks.
  3. Fault B, bare fetch: branch `claude/p0-14-drill-fetch`; add `domains/identity/drill.ts` with
     `export const go = (u: string) => fetch(u);`. Push, open the PR, wait.
  4. Fault C, cookie: branch `claude/p0-14-drill-cookie`; add `interfaces/http/drill.ts` with
     `export const c = "sid=1; Path=/; Domain=unset.sh; Secure";`. Push, open the PR, wait.
  5. For each of A–C: `gh pr view <n> --json mergeStateStatus,reviewDecision,statusCheckRollup`. Expected: the named check
     failed (`secrets` for A; `check` for B and C, with the guard's `report()` line in the log). `mergeStateStatus =
     BLOCKED` and a refused `gh pr merge` are **waiting until protection exists**; meanwhile the agent never tries to
     merge (agents never merge).
  6. Drill D, now (decision 41): record (a) `gh api repos/Undefined6799/unset/actions/permissions/workflow` →
     `default_workflow_permissions = "read"`, `can_approve_pull_request_reviews = false`; (b) `CLAUDE.md`'s Delivery
     section says agents never merge and never push to `main` (P0.09's `claude_md_agents_never_merge` passes on
     `main`); (c) ADR 0009 is present on `main`; (d) `gh api repos/Undefined6799/unset/rulesets` still refuses or is
     empty, recorded as the open threat-row-E item. Then skip to step 7.
     **Waiting until protection exists** (run the day the ruleset is applied; approval steps dropped under decision 40):
     Drill D, green but unapproved: branch `claude/p0-14-drill-approval`; add one line to `docs/human/drills/README.md` (a real,
     harmless change). Push, open the PR, wait until every required check is green. Then, in order, recording each:
     a. `reviewDecision = REVIEW_REQUIRED` and `mergeStateStatus = BLOCKED`.
     b. `gh pr merge <n> --squash` → refused.
     c. `gh pr merge <n> --squash --admin` → refused (empty bypass list; the app is not an admin anyway).
     d. `gh pr review <n> --approve` by the agent → refused (an author cannot approve their own PR).
     e. Ask Alex to approve (Alex tail). After his approval: `reviewDecision = APPROVED`.
     f. The agent pushes one more commit (another harmless line) → after checks, `reviewDecision = REVIEW_REQUIRED`
        again (dismiss-stale and last-push approval both proven).
     g. Alex approves again and merges (squash). Then `gh api repos/…/commits/<merged sha> --jq
        .commit.verification.verified` → `true` (signed-commit rule works under squash). `false` → Alex turns "require
        signed commits" off, the record says why, and P0-A3 is asked.
  7. Close the A–C PRs without merging; delete their branches. Closed PRs keep their refs on GitHub; the planted values
     are random (fault A's PEM block also matches gitleaks' private-key rule, which is fine: it is random bytes).
  8. Open the PR adding `docs/human/drills/phase-0-exit.md`; it must pass every check and is merged by Alex.

Edge cases and failures:
  - A drill PR shows `mergeStateStatus` other than `BLOCKED` (`UNSTABLE`, `CLEAN`) in steps 5 or 6a → the exit **fails**;
    stop and report which rule is missing (usually a required check not in the ruleset).
  - Any of 6b–6d succeeds → the exit fails; revert the merge by a PR, and report.
  - A guard fails for the wrong rule (fault C caught by Semgrep only) → the exit requires the guard the plan names
    (`cookie-domain`) to fire; fix the guard first.
  - Push protection blocks fault A → a pass; the `secrets` check is still proven by P0.07 step 5a.
  - The `main` CI run of drill D's merge fails → stop; `main` must be green at exit.

Done when (tests): (each with its run or PR URL in the record)
  - main_green: step 1 run is `success`.
  - secret_blocked: A blocked at push, or PR `BLOCKED` with `secrets` failed.
  - fetch_blocked: B `BLOCKED`, `check` failed, log shows `domains/identity/drill.ts:1  [egress]`.
  - cookie_blocked: C `BLOCKED`, `check` failed, log shows `interfaces/http/drill.ts:1  [cookie-domain]`.
  - token_read_only_and_no_actions_approval: step 6 (a).
  - delivery_rule_written: step 6 (b) and (c).
  - direct_push_refused and green_pr_cannot_merge_unprotected: **waiting until protection exists** (decision 41;
    P0.03's `direct_push_refused` and a refused merge of a red PR); the record says "waiting" and names L.04.
  - merged_commit_signed: **waiting until protection exists** (6g, or the recorded fallback).
  - (Dropped under decision 40: agent_cannot_merge_green_unapproved, admin_flag_refused, self_approval_refused,
    push_after_approval_dismisses; zero approvals are required.)
  - drill_recorded: `docs/human/drills/phase-0-exit.md` merged with every field filled and no planted value.

Reuse: bootstrap `scripts/guards/guards.test.ts:48-51,71-74` (planted fixtures inside unit tests) → LESSON (this drill
proves the same on GitHub with the ruleset). Provisional — for reuse review.
Not in this step: re-running the drill later (each later phase exit adds its own checks).
Diagram: none.

---

## Notes for the editor

Plan gaps, outline issues, cross-phase requests and Alex questions found while writing Phase 0 (rounds 1 and 2). No
shared file was edited.

### Still-open writer notes (round 1 numbering, with the reviewer's verdict applied)
1. **Required checks after the ruleset** (agreed): P0.07 is tagged `[ALEX]` for its tail, and the committed
   `.github/required-checks.json` is the one list; `workflow-pins.test.ts` checks every listed job exists and P0.07
   step 9 / P0.14 compare it with the ruleset. P1.11, P1.26 and P1.27 must append to the file with the same Alex tail.
2. **Alex cannot approve his own PRs** → P0-A1 (answered: Alex never authors).
3. **Private-repo limits** (agreed): CI gitleaks is the control; it now runs as a pinned CLI image.
4. **P0.02 pushes directly to `main`** once, into an empty repository; the ruleset follows within minutes (P0.03 now
   depends on the push, not on a merge).
5. **Renovate app install** (agreed): P0.08 is tagged `[ALEX]` for its tail.
6. **`allowed_signers` placement**: P0.10 creates it offline; **P1.33's runbook must place it** on the host. Please add.
7. **Host account 2FA** is added when a host exists (P1.34, P5.01).
8. **`unset.ac` registered in P0.11** (agreed), parked until P5.02.
9. **HSTS preload** not submitted; Alex decides later.
11. **Vault tool** not carried (agreed); notes are plain Markdown in P0.09a.
13. **Semgrep rules fetched at run time** (agreed: the rules licence allows internal use; vendoring would become
    redistribution once public). The job fails on zero rules loaded and logs the rule-pack versions.
15. **Budget mapping** (P0.05) is a first guess; warnings only.
16. **Exact-pin guard** kept and widened into the dependencies guard (workspace links, lockfile sources).
(Notes 10, 12 and 14 are replaced by P0-A2, P0-A3 and P0-A4 below.)

### Requests to the coordinator for other phase files
- **P1.01** must settle `packages/core/src/<area>` versus `packages/core/<area>`; later phases use both. CODEOWNERS uses
  `**` patterns meanwhile, and P1.01 adds the warning-level `codeowners_security_paths_match` test.
- **P1.24** should not enable Biome `noDangerouslySetInnerHtml`: the P0.06 `inner-html` guard is the single mechanism and
  has zero exemptions (P2.20 renders markdown to React elements).
- **P1.28** replaces `unset.sh`'s parked CAA (`issue ";"`) with the serving set before requesting certificates; **P1.34**
  does the same for the development PDS domain; **P5.02** for `unset.ac`. Each step's checklist needs that line.
- **P1.33** places `allowed_signers` (note 6) and records the Tailnet Lock disablement secrets in the P0.12 inventory.
- **P1.34, P1.35, P4.07, P5.04, P5.05** should cite the P0.12 inventory rows (K3; K1; K2; K3; K4) instead of
  "comes from P0.12". **P1.34** generates the development PDS recovery key with the P0.12 runbook.
- **P5.02** gains the production PDS key ceremony (recovery key and PLC rotation key, K-256), the hex conversion for
  `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX` (a short stdlib script copied to the offline machine with its checksum,
  round-tripped hex → multibase → `goat key inspect` → same `did:key` in the dry run), and an online check:
  `com.atproto.identity.getRecommendedDidCredentials` lists the recorded rotation `did:key`, with the recovery key first
  (`atproto/packages/pds/src/api/com/atproto/server/createAccount.ts:306-311`).
- **P1.14a** (`sealTo`) takes K2's `age1…` recipient from config; the P0.12 text assumes P1.14a exists, as the editor
  to-do list says.
- **P1.11, P1.26, P1.27** append to `.github/required-checks.json` (note 1). **P1.27** adds the first secret/OIDC job
  under the P0.07 environment rule; Alex creates the environment.
- **Outline:** P0.09a is new (letter suffix); P0.03 depends on P0.02's push; P0.12 depends on P0.10; the agent parts of
  P0.10–P0.13 depend on P0.07; P0.14 also depends on P0.03 and P0.08.

### Questions for Alex (from review r1; each recommendation is the reviewer's, provisional)
- **P0-A1. Who authors PRs, given admins-included and one approver?** (a) Alex never authors in `unset.sh`; agents open every
  PR (book default). (b) Alex is the ruleset's only bypass actor, "pull requests only", with an alert on every bypass.
  (c) A second human approver. *Recommendation (provisional): (a), which keeps "admins included" literally true.*
  **Answered by Alex 2026-10-03 11:46Z: (a) agents open every PR, Alex only approves; no bypass.**
- **P0-A2. Security updates and the 7-day release age.** (a) Immediate PR for advisories (Renovate's default), Alex's merge
  being the gate. (b) 7 days for everything, as the plan says. (c) 3 days for advisories. *Recommendation
  (provisional): (a).* The book keeps (b) until Alex answers, because the plan says 7 days without exception; the config
  sets the value explicitly either way, and the test only requires that it be present.
- **P0-A3. Signed commits on `main`** (asked only if P0.14 step 6g shows squash merges are not GitHub-signed). (a) Off.
  (b) Give agents an SSH signing key (a custody question). *Recommendation (provisional): on if the drill passes,
  otherwise (a).*
- **P0-A4. Custody of passphrases and identities.** (a) `age-plugin-yubikey` identities on both hardware keys for the
  legal-hold and backup identities, offline files only for the PLC keys. (b) Passphrase-encrypted files, passphrase in the
  password manager plus a sealed envelope in place 2 (book default). (c) (b) without the envelope. *Recommendation
  (provisional): (a) for anything decrypted more than once a year, (b) for the PLC keys.* Choosing (a) changes P0.12
  steps 5–7 for K2–K4 (identities generated on the hardware keys, two recipients per key) and the restore check.
  **Answered by Alex 2026-10-03 11:45Z: (a) keys used yearly or more (legal hold, backups) on both hardware keys; the
  rare recovery keys offline on paper or in a file.** Applied in P0.12 (custody classes, steps 4–9, tests) and P4.07.
- **P0-A5. The `@unset` npm scope belongs to someone else** (`@unset/superstruct`, a third-party maintainer). (a) Keep the
  `@unset/*` names; block the scope in `.npmrc` and enforce workspace links (book default, already built in P0.04 and
  P0.08). (b) Rename internal packages to a scope Alex registers now (e.g. `@unset-sh`) before any code exists. (c) Ask
  npm support for the dormant scope. *Recommendation (provisional): (b) if `plugin-api` may ever be published for
  third-party plugin authors, else (a); the `.npmrc` block stays in every case.* Decision 25 defers any `plugin-api`
  package to the first real plugin, so (a) stands until then.
  2026-10-05: with workspaces present, the scope block also covers `npm audit signatures`. That job alone overrides
  the scope registry for the key fetch (P0.07). P0.08's dependency guard closes the `npm ci` resolved-URL path. Option
  (a) stands.
- **P0-A6. Licence of the lexicon schemas**, which P1.35 publishes in Phase 1, before P0.13 is decided. (a) The schemas are
  interface data, exempt from "nothing public", under MIT or CC0. (b) Wait for P0.13. *Recommendation (provisional):
  (a).* **Answered by Alex 2026-10-03 11:49Z: (b) wait for the code licence; then answered by #54 at 11:50Z: the
  lexicon files are MIT.** P1.35 publishes them under MIT; nothing waits any more.
- **P0-A7. Renovate hosting.** (a) The hosted Mend app, scoped to this repository (a third party gets read/write on the
  private code). (b) Self-hosted Renovate in Actions with a fine-grained token in an environment-bound secret.
  *Recommendation (provisional): (a), for simplicity.*
- **P0-A8. Branch must be up to date before merging.** (a) Keep it strict. (b) Turn strict off and rely on the `main` CI run
  plus a red-`main` alert. *Recommendation (provisional): (a) until it hurts; record any change in an ADR.*

### Plan issues routed (defaults taken)
- **PI-1. The bundle moved** (now 41 commits at `ed1dd81`; its `main` ref is the 1-commit root). Default: P0.02 reads the
  tip at run time and compares with the recorded expectation in this file's header, which the agent may advance only for
  docs-only forward moves.
- **PI-2. graphify in CI** (plan §7, §9). Default: nothing in Phase 0 (no product code exists to graph); the
  reconciliation ADR lists it as deferred to **P2.13b** (editor pass 2026-10-04 evening), the first step after the
  slice-1 exit, when the first slice's code exists.
- **PI-3. TS 7 versus dependency-cruiser.** Default: dependency-cruiser with its swc parser (P0.05), proven by a
  cruised-count test; a home-grown guard only if that fails, by ADR.
- **PI-4. The `@unset` scope is third-party owned.** Default: P0-A5 (a) with the `.npmrc` block.
- **PI-5. Image scan, hadolint, cosign and SLSA "from commit 1".** Default: "from the first image" (P1.27); the reconciliation ADR lists
  them as deferred.
- **PI-6. "The report-routing decision"** (plan §8 Phase 0) has no Phase 0 step. Default: it is plan gap 6 (an app table
  listed by `admin` until Ozone, Phase 5), already adopted in ADR 0001; nothing to build in Phase 0.
- **PI-7.** The 720p fallback is pause-and-ask (decision 22), not automatic; nothing in Phase 0 depends on it.

### Round 2 changes

| Finding | Change in round 2 | Status |
|---|---|---|
| F1 bundle moved | Header records ref, tip, count, root; P0.02 reads `list-heads` at run time, pushes the tip of `HEAD`'s ref (never the bundle's `main`), checks root `baa2768`; docs-only forward moves update the record, anything else stops. ADR 0003 records file-level changes only. | fixed; the "coordinator writes the tip" idea replaced by the agent-updated record (coordinator default) |
| F2 test discovery | Whole-repository discovery and include, one `SKIP_DIRS` list; test `discover_includes_deploy_and_docs`; the "ignored by design" case removed. | fixed |
| F3 depcruise on TS 7 | swc parser + `@swc/core`; first-PR check; `depcruise_cruised_nonzero`; `typescript_single_major`. | fixed |
| F4 missing keys | P0.12 makes K1 (authority rotation, required), K2 (legal hold), K3 (backup), K4 (escrow); inventory rows for P1.33, P1.34, P5.02 keys; production PDS keys moved to P5.02. | fixed (production keys moved to P5.02, coordinator default) |
| F5 leak test | Multibase and age patterns, `sha256:` allowed; same patterns as gitleaks rules; run-time-built test keys. | fixed |
| F6 ceremony | Restore check (paper, USB 2, USB 3 → same public key); `--type K-256` (goat's default is P-256); tools copied with checksums; `HISTFILE`; depends on P0.10; agent part after P0.07. Hex conversion moved to P5.02 with the key that needs it. | fixed |
| F7 `@unset` scope | `.npmrc` scope block (P0.04); `"*"` only for linked workspaces; `workspace:` rejected; lockfile source and integrity checks; P0-A5. | fixed |
| F8 Renovate vulnerability age | `vulnerabilityAlerts` set explicitly with `minimumReleaseAge` and `rangeStrategy: pin`; test requires presence. | fixed; value kept at the plan's 7 days, not the reviewer's "immediate", until Alex answers P0-A2 (the plan wins over a review) |
| F9 secrets and OIDC | P0.03 sets Actions settings (GitHub-owned actions only, SHA pinning if offered, read token, no PR approval); P0.07 rule: no repository secrets, environment bound to `main`, OIDC gated, banned triggers; tests and `gh api` checks. | fixed |
| F10 approval never proven | P0.14 drill D (green unapproved, `--admin`, self-approval, push-after-approval). | fixed |
| F11 egress gaps | Client list extended (`http2`, `net`, `tls`, `dgram`, `ws`, dynamic `import()`, `import = require`), `WebSocket`/`EventSource`; fixture test. | fixed |
| F12 gitleaks-action | Replaced by the gitleaks CLI image pinned by digest, `git` + `dir`. | fixed |
| F13 listed/executed | `vitest list --filesOnly`; executed defined as a set; status mapping; two tests. | fixed |
| F14 pins | `vite` exact; `.nvmrc` exact; version picks stated as of 2026-10-03. | fixed |
| F15 unprotected window | Ruleset right after the push; CODEOWNERS PR goes through it. | fixed |
| F16 spoofable checks | Source GitHub Actions; test asserts `integration_id = 15368`. | fixed |
| F17 signed commits | On; verified in drill 6g; fallback recorded; P0-A3 only if it fails. | fixed |
| F18 CODEOWNERS paths | `**` patterns; missing areas added; P1.01 asked to settle `src/`. | fixed |
| F19 CI gaps | `maxLines` 300; non-required `duplicates` job (jscpd, advice only); graphify routed as PI-2. | fixed |
| F20 `npx` | Renovate validator from a pinned image; licence check via `npm ls` script; `ignore-scripts=true` in `.npmrc`. | fixed |
| F21 day-one dependencies | P0.11, P0.12, P0.13 split into Alex part and agent PR part inside each step (dependencies stated per part), not into new ids. | fixed (inline split instead of P0.11b/P0.12b, to avoid two new ids) |
| F22 domains | Parked and serving record sets; CAA follows the current issuer on serving domains; RDAP and `dig DS` checks; `xn--*` proposed. | fixed |
| F23 inner-html | Zero exemptions; the guard is the one mechanism; P1.24 asked not to add the Biome rule. | fixed |
| F24 CI details | `cancel-in-progress` only for PRs; no `${{` in any `run:`; `npm audit signatures`; `npm sbom`; Workflows write required in P0.01. | fixed |
| F25 P0.09 load | Split into P0.09 (docs) and P0.09a (notes, 21 research files); repository copy of the book canonical; archive = prototype at `054ab0f`. | fixed (canonical copy is a default for the coordinator to confirm) |
| F26 drill nits | PEM sentence fixed; no planted values in the record; `report()` format required and asserted. | fixed |
| F27 licence question | AI-authorship line, CLA/DCO follow-up, P0-A6 named. | fixed |
| F28 attested items | Each runbook line is "checked" or "attested by Alex (date)"; test enforces the label; RDAP, `dig DS`, fingerprints checked. | fixed |
| Editor notes 1, 5, 13 | P0.07 and P0.08 tagged `[ALEX]` tails; `required-checks.json`; Semgrep zero-rules failure and version log. | fixed |
| Editor notes 10, 12, 14 | Became P0-A2, P0-A3, P0-A4. | moved to Alex questions |
| PI-1 to PI-7 | Defaults applied as listed above. | applied |
| Coordinator defaults | Bundle record updated by the agent; smallest established TS-7 boundary option with a scanned-files test; `.npmrc` scope block + workspace links + P0-A5; P0.12 key set with production keys in P5.02 and a restore check; secrets/OIDC bound to `main` and Actions settings checked; drill D. | applied |

### Editor pass (2026-10-03)

- **P0.06**: (a) the `egress` guard gets one fixed file exemption, `apps/pds-admin/pds.mjs`, with tests (phase-2 E10,
  E23); (b) new rule `ip-columns`, the "no IP written" schema check that P3.17 and P4.03/P4.07 already cite, with an
  allow file that starts empty and is filled only by the owning steps (phase-4 Notes 1c; phase-3 P3.17); (c) the
  `web-no-moderator` verb pattern now also covers `preserve.*`, `account.*` and `pds.health` (editor resolution 3, P3.16c
  and P3.16d verb names). Rule count four → five; size raised a little.
- **P0.09 / P0.09a**: `CLAUDE.md` names the vault note `v2e-visual-direction-locked` as superseded by the unset.sh
  design sheet, with a test; the notes README lists both v2e notes as "superseded, not carried" (phase-1 Notes item 21).
- **P0.09b (new)**: severity definitions, labels, bug template and triage form, moved early from L.02 (phase-5 and
  launch-gate Notes, round 1 F21; editor to-do). Agreed with the phase-1 editor, who does not add P1.36a.
- **P0.12**: K2's "used by" follows editor resolutions 2 and 3 (P4.03, P4.07, P5.07b; no longer P2.16, which now uses
  only the fake `FingerprintCheck` and no buffer).
- **Alex question labels** namespaced to `P0-A1` … `P0-A8` (editor resolution 9).
- **Outline (for the lead)**: add P0.09b (depends on P0.03, P0.07; L.02 depends on it); P0.06 outline text gains
  "pds-admin file exemption, IP-column check".
- **Not applied**: none of the other files' requests to P0.* were rejected. The P0.11 chat hostnames (phase-6 plan issue
  P9) need no Phase 0 change: they are `unset.sh` subdomains, so registering them is not a Phase 0 domain task.

**Alex's answers and plan decisions 24–26 applied (2026-10-03, answers editor)**
- **P0.03** (#2, P0-A1): marked settled; agents open every PR, Alex only approves, no bypass.
- **P0.09b** (#3, P5-A5 = L-A1): `docs/severity.md` is confirmed as drafted; the "draft" status line is dropped.
- **P0.12** (#1, P0-A4): two custody classes. K2–K4 (opened yearly or more) are wrapped to both hardware keys'
  `age-plugin-yubikey` identities (new inventory rows Y1, Y2), with two USB copies and no paper or passphrase; K1, K1b and
  the PDS recovery and rotation keys keep paper plus an `age -p` file. Steps 4–9, the edge cases, the tests and the
  diagram follow. (#6, P1b-A4) K1b, the authority's backup rotation key, is added to the ceremony. (#11, P1.32 Q2) the
  Tailnet Lock disablement secrets: Alex only, two sealed offline copies in places 1 and 2.
- **P0.13** (#7 and #54): answered; AGPL-3.0-only for the apps, MIT for the small building blocks (proposed list
  `net-guard`, `admin-shared`, `lexicons`, confirmed in the ADR PR) and the lexicon files; per-package `LICENSE` files and
  `license` fields; the licence check runs per package. P0-A6 is settled by the same answer.
- **P0.05** (decision 25): the two plugin dependency-cruiser rules (`plugins-only-api-and-ui`,
  `core-imports-only-plugin-registry`), their test and the `plugin-api` line budget are removed; the first real plugin
  brings its own boundary lint.

**Editor pass (2026-10-03, Iconoir)**
- **P0.09** (Alex, 2026-10-03 18:00Z, alex-answers #12b: Iconoir for all icons, via SVGs copied onto the design sheet
  at 7.12.1): v2e (amber, serif face, chamfers, `UiIcon`, `--v2e-*`) stays superseded; `CLAUDE.md` gains one line naming
  Iconoir through the sheet's Icon list and P1.24's `Icon`, never an icon package. Test `v2e_superseded` rewritten to
  still block v2e and to expect that line. Iconoir is MIT, inside licence decision 27 (P0.13 needs no change; the
  notice file is P1.24's).

### Editor pass (2026-10-04, decision 34)

- Paths rewritten to the decision-34 layout from `layout-map.md` by script (`apply.py`); prototype citations, external
  repositories (atproto, Synapse docs, Element) and Notes written before 2026-10-04 keep their old paths as history.
- P0.02: the bundle README's layout table lists the decision-34 folders.
- P0.03: CODEOWNERS security sections rewritten to the new folders (no more `packages/core/**` globs); chat paths;
  `.dependency-cruiser.cjs` added.
- P0.05: boundary rules `app-not-infrastructure`, `domain-pure`, `infrastructure-not-entry`, `shared-leaf`,
  `admin-services-builtins-only` (pds-admin and chat-admin), `vendor-sdk-only-in-infrastructure`; `web-not-admin` covers
  `interfaces/http`; one fixture per forbidden edge plus an allowed-edges fixture; budgets mapped onto the new folders.
- P0.06: `SCANNED_DIRS` are the decision-34 folders (egress exempts `infrastructure/net-guard/`, coordinator note,
  plan commit `ca63b29`); `inner-html` and `web-no-moderator` scopes follow.
- P0.13: MIT scope is `shared/` (decision 27 as amended by A6, plan §8 Phase 0): `net-guard` and the admin envelope
  code become AGPL; root `LICENSE-MIT` added.

### Editor pass (2026-10-04 05:10Z refinement, decision 34)

- Layout open points resolved by the architecture thread (guideline §1 refined 05:10Z; `layout-map.md`): P0.03 CODEOWNERS (`shared/http`, `shared/admin-envelope`, the extra interfaces, `docs/human/runbooks`); P0.05 rules `app-only-shared`, `app-render-entry-only`, `no-interface-to-interface`, `admin-services-zero-deps` + `allowlist-zero-deps` (allowlist = `shared/admin-envelope/`, Alex approves additions), `vendor-sdk-one-adapter` with the `SDK_ADAPTERS` table, each with fixture tests; budgets include `shared/http` and `shared/admin-envelope`; P0.13: the admin envelope is MIT under `shared/`, `net-guard` AGPL; docs paths per O-10.

### Editor pass (2026-10-04, findings)

Source: `../architecture-handoff/step-book-findings.md`; verdicts in `reviews/step-book-findings-triage.md`.
- P0.04 (F-24): case-level skip check (`skippedCases`), stray test-like files outside the include (`*.spec.*` outside
  `tests/e2e/`, `*.test.js`), `test.retry = 0`, test files inside `typecheck`; four tests. The Playwright half already
  existed (P1.26 `assert-tests-ran`, `retries: 0`).
- P0.05 (F-17): rules `domain-cross-via-index`, `domain-no-io-builtins`, `no-product-imports-tooling` with fixtures.
  Not adopted: "only the composition root imports `infrastructure/`" (P3.05/P3.06 place adapter calls in other
  `interfaces/indexer` files) and "no production import of fakes" (P2.16 wires the fake check in the composition root
  for the test track by design; the P5.07b boot refusal is the control).
- P0.09 (F-20, F-33): `docs/human/glossary.md` is the canonical glossary (guideline §6); a PR template with README
  rule 11's headings plus a security-review heading.
- `Threats:` heading (F-26, README step template) filled for P0.03, P0.06, P0.07, P0.08, P0.10, P0.12.
- Editor pass (2026-10-04, findings follow-up): P0.09's PR template adds DL-3's seven sections, filled or `n/a` (architecture thread outcome on F-33). F-04 kept as designed (no pds-admin status query; unknown stays unknown, P3.20b reconciles). F-08/F-13 defaults and F-25's stop confirmed.

### Editor pass (2026-10-04, decision 35)

Decision 35 (Alex, 2026-10-04 12:56Z, "Adopt all"; `../engineering/engineering-rules.md`) and the coordinator's
alignment with the plan (commit `1016b44`):
- Header: the engineering rules are binding; the bundle facts since decision 35 (engineering-rules files, ADR 0002 =
  engineering rules, ADR 0001 append-only, CLAUDE.md import, precedence line and Delivery section).
- ADR renumbering: P0.02's reconciliation ADR is now **0003** everywhere (was 0002, which is the engineering rules).
- P0.01 (D2, F-34): squash commit title = PR title, message = commit messages; `merge_settings` test extended.
- P0.05 (D1, F-35; F-19): `noExcessiveCognitiveComplexity` at warn; every *(unverified)* Biome rule name is confirmed
  against the pinned schema before it is switched on, with fallbacks recorded, and three tests.
- P0.09 (D4, D8, F-23, F-33): CLAUDE.md keeps the top-15 import, the precedence rule and the Delivery section (D1–D4,
  D8); ADR index rows 0001–0003; a no-orchestrator ADR (F-23; placed here because P0.04 writes no ADRs); the PR
  template carries all of DL-3's fields; tests `claude_md_rules_import`, `adr_index_complete`, `adr_immutable`.
- New step **P0.09c** (D2, D3; plan §8 Phase 0 CI list): `checkCommitMessage`, PR-title, PR-size and PR-template checks in
  one `pr-shape` CI job (values only through `env:`), an opt-in `.githooks/commit-msg`, labels `large-pr` and `kind/*`.
  P0.07's "Not in this step" points to it. Renovate's subjects use the `P0.08` prefix (lead default, recorded in P0.09c).
- Not changed: P0.14's drills (the plan's Phase 0 exit does not name the new checks; P0.09c records its own planted run).

### Editor pass (2026-10-04, bibliography review)

Source: `reviews/bibliography-review/00-synthesis.md` and `r-06-critic.md` §3, plus the architecture thread's settled
points (rules file and guideline re-read 13:28Z).
- P0.05 (R1-01, AB-1): the dependency-cruiser config is now an allowlist matrix (`allowed`, `allowedSeverity: "error"`,
  one `MATRIX` constant); an unlisted edge fails as `not-in-allowed`. "The rules forbid only what they name" is gone;
  the named rules stay as fixtures. New tests `depcruise_unlisted_edge_fails`, `depcruise_matrix_rows_have_fixtures`.
- P0.05 (AB-1 domain row, settled 2026-10-04): domains import only their own contracts, other domains' `index.ts`,
  `shared/errors`, `shared/config` types and `shared/lexicons`; no npm package (`@atproto/lex` only through
  `shared/lexicons`), no Node I/O. Test `depcruise_domain_imports`.
- P0.05 (R4-01, TE-1 final form): new rule `fake-only-in-composition-root` (`*.fake.ts` only from tests and
  `interfaces/*/compose.ts`, there only by a dynamic import behind the non-prod check); tests
  `depcruise_fake_only_in_composition_root`, `fake_files_outside_domains`, and the startup test
  `fake_boot_refused_in_prod` (prod boot refuses and no fake module is resolved).
- P0.03 (SE-6 as extended): CODEOWNERS names `/deployment/edge/` on its own line, `/interfaces/legal-hold-export/` (was `/tools/…`, see below) with the
  legal-hold seal path, and the serialiser and `safeHref` files (also on SE-6's list and missing before); `chat-auth`
  and `/shared/lexicons/` were already listed. `interfaces/retention` dropped (R5-01). New check
  `codeowners_covers_trusted_base`.
- P0.09 (AB-4): depends on P0.05; new test `architecture_rule_table_matches_depcruise` reads the rule table of
  `docs/human/architecture.md` (an input from the plan thread) against the dependency-cruiser config.
- SE-7 carve-out: no Phase 0 step applies the log rule to the audit lanes, `pds-admin`'s log or the sealed buffer;
  nothing changed.

### Editor pass (2026-10-04, bibliography review, follow-up)

- P0.03: a `# trusted base (SE-6)` CODEOWNERS section, the machine-read list. The legal-hold export path is now
  `/interfaces/legal-hold-export/` (architecture thread: there is no top-level `tools/`).
- P0.09c (rule SE-6; coordinator item h): new `checkTrustedBaseIsolation` in `pr-shape`. A PR touching a trusted-base
  path touches only trusted-base files, their tests and docs, with no override. Tests `trusted_base_isolated` and
  `trusted_base_list_from_codeowners`.
- P0.09c (PF-1; item f): new `checkPerfEvidence`. A migration adding `-- why: speed` needs p50/p95/p99 in the PR.
  Test `perf_evidence_required`.
- ADRs (item ii): 0003 is decision 36 and 0004 is decision 37. The bootstrap reconciliation ADR takes the next free
  number when written (P0.02, P0.05's fallbacks, P0.09's index rows, the plan-issue defaults). History notes keep "0003".

### Editor pass (2026-10-04, SE-6 ruling)

The architecture thread's ruling on SE-6 (plan §9 and the rule as folded at `f9b48f8`): the trusted base keeps
`shared/http/`; "migrations" narrows to role and grant changes on objects that already exist (a new role, a role
attribute, a grant widened or narrowed on an existing table, column, function or schema, default privileges, row-level
policies), whether in `roles.json` or a migration; a migration creating new tables, columns or functions (SECURITY
DEFINER included), with the grants on those new objects only, rides with its feature step and keeps CODEOWNERS review.

- P0.03: the `# trusted base (SE-6)` section no longer lists `/infrastructure/postgres/migrations/` and `roles.json`
  as whole paths; one `# parsed:` line names them and `grant-matrix.json` for P0.09c's grant parse. The review section
  keeps `/infrastructure/postgres/` whole. `codeowners_covers_trusted_base` wording follows.
- P0.09c: new pure `classifyGrantChanges` (`grant-parse.ts`): existing versus created objects from the base and head
  migrations, an always-trusted list, a trusted-unless-created list, a closed neutral list, and `unclassified` (trusted)
  for everything else; `roles.json` and `grant-matrix.json` parsed as JSON. `checkTrustedBaseIsolation` takes the
  findings; a file mixing trusted and feature statements fails as `mixed_grant_change`. New tests
  `grant_parse_feature_create_and_grant_passes`, `grant_parse_widen_existing_fails`, `grant_parse_unparseable_fails`,
  `grant_parse_cases`; `trusted_base_isolated` updated. Size ~230 source and ~330 test lines.
- `grant-matrix.json` is parsed too (the ruling names `roles.json` and migrations): in this book `roles.json` is the
  roster and `grant-matrix.json` holds the per-object grants, and a grants-only PR must be able to carry its matrix
  rows without failing isolation.
- Split-step naming: a trusted-base kit change is `<id>k` and a grants change `<id>g`, one letter so `checkCommitMessage`'s
  id pattern still matches. The steps split this pass are listed in `01-outline.md` ("Editor pass (2026-10-04, SE-6
  ruling)").
- P0.03 (coordinator follow-up): `/deployment/postgres/init/` joins the `# trusted base (SE-6)` section as a whole
  path. The bootstrap script creates roles and revokes rights but runs as the superuser at `initdb`, before any
  migration, and creates `migrator` itself, so moving it into `roles.json` or a migration is not possible; a whole path
  is the clean option. P1.11g lands it alone.
- Open, for the architecture thread: `erasure-registry.json` is still a whole-path trusted-base file (`eraseDid`), yet
  every feature step that creates a DID column adds its row there (P1.13); under the isolation check each such step
  would fail. Either the registry goes through a parse like the grants (new rows for new columns ride) or those steps
  split. Not decided here.

### Editor pass (2026-10-04, SE-6 follow-up ruling)

The architecture thread ruled on the five follow-ups and SE-6 was updated (engineering rules; plan §9 folded at `6275827`, whose feature-step list reads "tables, columns,
views, sequences or functions, with the grants on those new objects and the erasure-registry rows for columns the same
PR creates").

- P0.03: `roles.json` is a whole-path trusted-base entry again; the `# parsed:` line names migrations,
  `grant-matrix.json` and `erasure-registry.json` (the registry moved there from the `eraseDid` paths). The earlier
  "Open" item on the registry is answered: new rows for columns the same PR creates ride; changed or removed rows are
  trusted base.
- P0.09c: `classifyGrantChanges` rewritten to SE-6's "Enforced by" wording exactly: trusted = a role statement or
  attribute, a schema grant, `GRANT`/`REVOKE`, default privileges or a policy change on an object the PR does not
  create, a changed or removed registry row; everything outside the closed neutral list is `unclassified`, trusted
  (fail closed). Dropped as named categories: `OWNER TO`, `ALTER FUNCTION … SECURITY DEFINER` (both now fail closed
  as unclassified), and `CREATE OR REPLACE` of an existing function (now neutral: SE-6 does not list it). Views and
  sequences are created objects like tables (confirmed). Tests updated: registry and view/sequence rows,
  `roles.json` handled by path, unparseable case (d) is now a broken registry.
- Coordinator item-5 gap fixes, recorded under the previous note: `/deployment/postgres/init/` as a whole path
  (P1.11g).

### Editor pass (2026-10-04, SE-6 follow-up corrections)

Coordinator corrections after the follow-up ruling (plan §9 at `6275827`):

- P0.09c rule 3e: any `CREATE OR REPLACE` or `ALTER` of a function or view the PR does not create is trusted base
  (SE-6's updated "Enforced by"; plan §9 at `badf15a`: "any change to a function or view the PR does not create: a
  replaced body or definition, or an altered SECURITY, owner or search_path"): bodies, definitions, `SECURITY`, owner,
  `search_path`; invoker functions too. This reverses the earlier note's "now neutral". New tests
  `grant_parse_replace_definer_fails` and `grant_parse_existing_function_or_view_changed` (an existing invoker
  function, an existing view, `ALTER … SET search_path`); the `grant_parse_cases` row flips to trusted.
- P0.09c rule 3f and P0.03's `# trusted functions:` line: the `eraseDid` SQL functions are trusted base even when
  created new (SE-6 lists `eraseDid`), so P3.07's split (P3.07k) lands as a trusted-base PR.
- ADD COLUMN gap, option **(a)** chosen (rule 3g, test `grant_parse_add_column`; P1.12 gains the `wholeTable` flag
  and the test that enforces it). Why not (b): P1.12's matrix is table-level by design, and its baseline default
  privileges give `web` table-level SELECT/INSERT/UPDATE/DELETE on every `app` table, so (b) would rewrite P1.12's
  baseline and every table's grants in Phases 2–6. With the flag, the review that creates a table records once
  whether each table-level grant is meant to cover future columns; where it is, an added column rides, and where it
  is not, the column needs a grants step or a column-level grant. Most app tables `web` owns get the flag at creation,
  so few feature steps split.

### Editor pass (2026-10-04 evening)

Editor pass A (relays to 22:40Z: column-list ruling at plan `9c54e52`; the PR #7 review; decisions 40, 41, 42; the
build thread's as-built facts for P0.02–P0.08; the architecture ruling on CLAUDE.md; AI notes upkeep).

- Header: phase exit restated for decisions 40/41 (CI blocks the three planted faults; read-only Actions token; the
  main-branch rules written in `CLAUDE.md` and ADR 0009; no GitHub-enforced protection while private on the free plan);
  the bundle expectation updated (tip `24470d5`, 51 commits, root `3edd0de`, PR #1 merged `e1d7bcd` as `6e9a02b`); ADR
  numbers 0001–0010 listed, reconciliation ADR = 0007, next free 0011 (the no-orchestrator ADR).
- P0.01: the repository is `Undefined6799/unset`.
- P0.02: as built (PR #1 merge, draft PR #5 = the rest, ADR 0007); step 3c as-built note; no separate folder-layout
  step; graphify deferred to P2.13b.
- P0.03: GitHub's refusal recorded (decision 41); decision-40 ruleset (zero approvals, no code-owner review) kept as a
  deferred one-command step; Actions settings done; step 5a no longer waits (P0.07, P0.08 merged; no temporary
  allowance for the third-party gitleaks action); CODEOWNERS broad before narrow (`codeowners_broad_before_narrow`)
  and the trusted-base section last with no blank lines; `# trusted functions:` growth rule (P1.15 audit append,
  P4.07k/P4.07h legal-hold definers); threat row E rewritten (accepted, compensating controls, revisit, L.04 check);
  P0-A1's separate identity dropped.
- P0.04: TypeScript 7.0.2 and `@types/node` 26.6.3 already on `main` (Dependabot #3, #4).
- P0.05 (PR #9): deviations recorded (root config files, `noConsole` off in `scripts/**`, `.mts`/`.cts` refused, Biome
  tests in `scripts/lint/biome.test.ts`, computed `import()`/`require()` and `noFloatingPromises` moved to the Semgrep
  custom-rules step). Their home is the new step **P1.01s**.
- P0.06 (PR #10, #11): `setHTMLUnsafe(` and `Document.parseHTMLUnsafe(` join the raw-HTML sink list (Alex approved).
- P0.07 (PR #13): gitleaks image, scratch branch from Alex, Alex tail deferred, `min-release-age=7`, root
  `"version": "0.0.0"`.
- P0.08 (PR #15): `workspaceNames` from the root `workspaces` globs; regex `customManager` for `*_IMAGE`; validator
  `renovate/renovate:44.115.13` with `--strict`; Renovate installed on `unset` only; Dependabot security updates off,
  alerts on.
- P0.09: five imports, Top 15 among them (test); 120-line budget; Top 15 intro wording logged as a deviation; Delivery
  says agents never merge and never push to `main` (test `claude_md_agents_never_merge`); PR template `AI notes` line;
  `security@unset.sh`; ADR rows 0005–0011; the architecture-table "planned: <step id>" convention in the AB-4 test;
  the book copy is the step's last act; the notes table replaced by the plan's one-line `importance: high` rule.
- P0.09a: retired (plan §7/§8 Phase 0: no old note carried wholesale; `.00` steps port what they need).
- P0.09c: CODEOWNERS parser spec (section last, no blank lines; test cases); trusted function families fail closed
  until named (`audit` schema functions, legal-hold `SECURITY DEFINER` functions; test `grant_parse_trusted_families`);
  Alex tail deferred.
- **P0.09d (new)**: AI notes vault skeleton and the notes guard (parallel-safe; depends on P0.06).
- P0.11: real mail behind `security@unset.sh`; CAA `iodef` names it.
- P0.14: drill D replaced by checks of what exists; protection drills "waiting until protection exists"; approval
  drills dropped under decision 40.
- Open for the plan: the brief's "SECURITY DEFINER function under `domains/moderation/legal-hold/` migrations" read as
  legal-hold migrations under `infrastructure/postgres/migrations/` (migrations do not live in `domains/`).
