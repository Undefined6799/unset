Architecture and Development Guideline (unset.sh)

Status: ADOPTED by Alex 2026-10-04 04:39Z ("Apply all" card). Section 1 refined 05:10Z for the
step book's layout-map open points O-1..O-11 (no change to intent); 13:35Z: jobs and retention are
one process, domain imports listed. Adapted from the "Project Architecture & Development
Handoff" (verbatim in unset-plan/architecture-handoff/chatgpt-handoff-verbatim.md) with six
amendments that keep decisions Alex already made. Each amendment is marked [A1]..[A6] and explained
in unset-plan/architecture-handoff/conflicts.md. It is the fourth guideline document
next to Architecture Instructions, Engineering Practices Addendum, and Engineering Workflow & Change
Management. Where this document and the plan disagree, this document governs structure and process;
the plan governs product and security decisions.

1. Core Architecture [A1]

unset.sh/
├── apps/                 user-facing applications: UI only, no product rules, no database access
│   ├── web/              public application (unset.sh)
│   ├── admin/            admin screens and islands (Tailscale only)
│   └── chat/             chat client on its own origin (chat.unset.sh), Phase 6
│
├── interfaces/           entry points; one folder per running process, each its own container
│   ├── http/             web server: routes, forms, its jobs
│   ├── admin/            admin server: gate, session, enrolment, actions
│   ├── api/              public read API, own database role
│   ├── indexer/          reads records from the network (Tap consumer)
│   ├── media/            media proxy on the media domain
│   ├── review/           upload checks (no-network compute + review-egress)
│   ├── jobs/  audit-verify/  chat-auth/   other processes, added in their phase
│   │                     (jobs = all scheduled work incl. retention, under the retention role)
│   ├── pds-admin/        sole holder of the PDS admin password; zero dependencies
│   └── chat-admin/       Phase 6; zero dependencies
│
├── domains/              product rules, in product words
│   ├── identity/         sign-in, sessions, handle verification, profile
│   ├── content/          video posts, captions, drafts
│   ├── social/           follows, likes, blocks
│   ├── feed/             feed tabs
│   ├── messaging/        chat rules, Phase 6
│   ├── moderation/       gates, reports, holds, legal-hold rules
│   └── privacy/          erasure, export, retention
│
├── infrastructure/       external systems behind small contracts
│   ├── postgres/  pds/  tap/  matrix/  storage/  arachnid/  email/
│   ├── net-guard/        the single egress classifier
│   ├── seal/             sealed-storage encryption
│   └── audit/            append-only audit store
│
├── shared/               genuinely generic code, kept small; MIT licence [A6]
│   ├── lexicons/         sh.unset.* record types and generated code
│   ├── ui/               tokens, shared components, Icon
│   ├── http/             server kit: server, CSRF gate, CSP, limits, client IP, return path
│   ├── admin-envelope/   signed admin action format, canonicalize, roster; zero dependencies
│   └── config/  errors/  log/  i18n/
│
├── deployment/           compose, edge, backup, preflight
│                         terraform/ and ansible/ are added at P5.00 when hosting is chosen
├── scripts/              repository tooling only: CI guards, budgets, dev seed
├── tests/                integration/ and e2e/ [A5]
└── docs/
    ├── human/            guides, features/, decisions/ (ADRs), engineering/ (the guidelines),
    │                     runbooks/, drills/, compliance/, legal/, phase-exit records
    └── ai/               plan, step book, handoffs, investigations, working notes

Folders are created when their first code lands, never ahead of it.

Folder responsibilities

* apps/ hold screens, islands and styles and import only shared/. The server renders them: the
  interface that serves an app (interfaces/http for web, interfaces/admin for admin) may import that
  app's render entry and pass it data as props. Islands reach the server over HTTP, never by import.
* interfaces/ are the doors: they authenticate, apply the CSRF gate and limits, call a domain, and
  shape the response. Every running process has its own folder here, so process, network and
  database-role isolation from the plan stays intact; a new process adds a folder, never shares one.
  Interfaces do not import each other; code two of them need goes to shared/ (no product meaning)
  or a domain.
* pds-admin/ and chat-admin/ may import only their own folder, Node built-ins, and folders on the
  zero-dependency allowlist (today: shared/admin-envelope/). An allowlisted folder obeys the same
  rule, so nothing reaches these services transitively. Adding to the allowlist needs Alex's
  approval in the PR. dependency-cruiser enforces both.
* domains/ hold product rules and depend only on contracts they define; infrastructure implements
  those contracts. A domain may also import other domains' index.ts, shared/errors, shared/config
  types and shared/lexicons (the record validator); nothing else from outside. The composition root in each interface wires them.
* infrastructure/ translates external concepts at the boundary. A vendor SDK is imported in exactly
  one adapter folder per runtime: infrastructure/<system>/ on the server, apps/chat/matrix/ for
  matrix-js-sdk in the browser chat client. shared/lexicons/ may use @atproto/lex for its generated
  code. dependency-cruiser enforces each case by name.
* shared/ holds only code with no product meaning. If it has product meaning, it belongs to a domain.
* deployment/ holds what puts the system on machines, backup scripts included. No Redis, queue or
  other service is added without a concrete need; Postgres and in-memory limits are the default.
* scripts/ holds repository tooling (CI guards, budgets, dev seed). Product code never imports it.
* tests/ hold integration and end-to-end tests. Unit tests sit next to the code they test.
* docs/human/ holds what a person must read or follow and is kept current; docs/ai/ is working material.

2. Architecture Rules

* UI code belongs in the appropriate app.
* Business logic belongs in the appropriate domain.
* External technical systems belong behind infrastructure boundaries.
* Interfaces define how things communicate with the system.
* Domains do not depend on infrastructure, interfaces or apps.
* Apps do not import each other. Avoid unnecessary cross-domain dependencies.
* Every folder has a clear responsibility and owner.
* No deep folder structures without a concrete reason.
* Reuse existing services and components when they already own the responsibility.
* No abstractions because they might be useful later.
* Security boundaries from the plan (separate processes, database roles, networks, origins) are
  never merged for folder convenience.

3. File Organization

Do not automatically create one file per feature. Every file has a clear responsibility.

Split a file only at a genuine clarity boundary: independent responsibilities mixed together, a
file that is hard to understand, logic that must evolve independently, or code that belongs to a
different layer.

Before creating a file, determine:

1. What responsibility does it have?
2. Which architectural area owns it?
3. Does an existing file already own this responsibility?

4. Feature Ownership

For each feature, identify its path before implementation. Example, posting a video:

apps/web → interfaces/http → domains/content (+ domains/moderation) → infrastructure/pds, storage → PDS

Important features have a predictable ownership path and consistent naming. Each step-book phase's
refine step records the paths for that phase; larger features document theirs in
docs/human/features/<feature>.md when their first slice lands.

5. Testing [A5]

* Unit tests: next to the file they test (*.test.ts), so they move with it.
* Integration tests: tests/integration/.
* End-to-end tests: tests/e2e/ (Playwright, both themes).
* Vitest only; CI fails if any discovered test did not run.

Let the structure grow with the project.

6. Human Documentation

Maintain docs/human/ as living documentation: README, getting-started, architecture, conventions,
glossary, features/, decisions/ and engineering/. It answers what the project is, how to run it,
how it is organized, where new code belongs, how to add a feature, how the major features work and
how to run tests. A new developer should understand the project without reverse-engineering it.

7. AI Documentation

AI notes, plans, handoffs and investigations live under docs/ai/, never scattered through the
source tree. Remove temporary artifacts with no lasting value.

8. Plugins

No plugins folder and no plugin system until the first real plugin (decision 25). When one
arrives, its UI lives inside the app (apps/web/plugins/), its server-side data gets its own Postgres
schema and role (plan §5.5), and it uses only approved interfaces and domains; never databases,
domain internals, Matrix clients or other private implementation details. A formal third-party
plugin system (SDK, permissions, sandboxing, versioning, extension points) is designed only when
third-party plugins become a real requirement.

9. Initial CI [A2] [A3]

Pull request → typecheck (TypeScript 7) → Biome (lint and format, CSS token rules included) →
dependency-cruiser (architecture boundaries) → unit tests (discovered equals executed) → build.

Security and supply-chain checks run from the first commit: secret scanning, dependency audit,
Semgrep, actions pinned by SHA. Image scanning and signing start with the first container image;
accessibility and performance gates start with the first page. Heavier checks are added when there
is a concrete reason.

10. Development Workflow

For every meaningful change:

1. Understand the relevant architecture.
2. Identify the owning domain or app.
3. Read the relevant human documentation.
4. Inspect the existing implementation.
5. Reuse existing code where appropriate.
6. Explain the proposed change.
7. Make the smallest appropriate change.
8. Run tests.
9. Run type checking and linting.
10. Check architecture boundaries.
11. Review the diff.
12. Remove unnecessary changes.
13. Only then move to the next task.

Never blindly follow an old plan if the codebase shows it is now incorrect or unnecessary. Flag the
conflict and explain it.

11. Development Philosophy

The plan and step book are a roadmap, not a command to execute blindly.

Alex defines product and architectural intent → AI implements → tests verify behaviour → CI
enforces rules → Alex reviews important decisions.

The repository and automated checks enforce the architecture, rather than relying on the AI to
remember it.

12. Start Small [A4]

Build one small, complete happy path first: sign in with an atproto account and see your own
profile page.

apps/web → interfaces/http → domains/identity → infrastructure/pds → development PDS

It includes only the security pieces that path needs (typed config, CSRF gate, CSP, OAuth session,
Postgres with roles, net-guard for handle resolution). Then test it, review the architecture,
document what was learned, fix problems, and only then add the next slice.

No speculative infrastructure, abstractions, folders, plugins or services before the project needs them.

13. Naming

Use clear, predictable names that show ownership and purpose: MessageService, MessageRepository,
MatrixMessageGateway. Never Helper, Manager, Thing, Utils2 or ServiceWrapper.

14. Final Rule

Before adding a new file, folder, abstraction, dependency or service, ask: what responsibility does
this have, where does it belong, and why does it need to exist now?

Prefer the smallest structure that clearly expresses the architecture.
