# Engineering Practices — Addendum

These principles complement the existing Architecture Instructions. Do not duplicate or override them. Use them as additional guidance when implementing and maintaining the application.

## 1. Code quality and maintainability

Write code that is easy to understand, change, and verify.

Prefer clear intent, simple designs, meaningful abstractions, and well-defined responsibilities. Use refactoring to improve structure while preserving behavior.

Apply clean-code ideas pragmatically rather than mechanically. Manage complexity by hiding genuinely complex details behind useful abstractions instead of adding layers that merely rename or relocate complexity.

Leave code at least as maintainable as you found it, and improve it when a change provides a clear opportunity to do so.

## 2. Testing principles

Use testing as a feedback mechanism rather than as a compliance exercise.

- Make small changes and verify them quickly.
- Let testability inform architecture. If something is unnecessarily difficult to test, reconsider its responsibilities, dependencies, or boundaries.
- Test observable behavior rather than implementation details.
- Keep tests simple, deterministic, understandable, and maintainable.
- Prefer the simplest test that provides meaningful confidence.
- Use focused tests for local behavior, integration tests at important boundaries, and a smaller number of end-to-end tests for critical application flows.
- Do not write tests merely to increase test count or satisfy a coverage target.

Testing is part of the normal development loop.

## 3. Verification and linting

After meaningful changes, follow the project's established verification process:

Understand → Plan → Implement → Format → Lint → Type-check → Test → Diagnose → Fix → Re-run checks → Review diff → Continue.

Use the repository's configured formatting, linting, type-checking, and testing tools.

Do not bypass, disable, or weaken existing checks merely to make a change pass. If a check reveals a genuine problem, fix the underlying issue. If an existing rule appears incorrect or inappropriate, surface the issue rather than silently working around it.

Do not invent new tooling or rules when the project already has an established solution.

## 4. Security as a first-class concern

Treat security as a fundamental part of implementation and design.

Follow established secure-development practices and recognized security standards rather than inventing security mechanisms unnecessarily.

Use secure defaults, protect sensitive information, validate trust boundaries, apply appropriate access controls, and avoid weakening security controls for convenience.

Security requirements should be considered during design and implementation, not added only at the end.

The goal is production-quality software that follows recognized security practices, even though the project itself is not claiming formal certification unless that has explicitly been established.

## 5. Dependencies and supply-chain safety

Use established libraries and dependencies when they solve a real problem well. Do not reinvent proven solutions unnecessarily.

Treat dependencies as part of the project's software supply chain. Prefer reputable, well-maintained dependencies and consider their security, maintenance, licensing, compatibility, and long-term implications before introducing them.

All direct dependencies must be recorded in the project's dependency manifest using the package manager's normal mechanism. Use the corresponding lockfile so the resolved dependency versions are reproducible.

Do not manually maintain a second list of every package.

When introducing a meaningful dependency, briefly record what problem it solves, why it was chosen, and any important security or maintenance considerations. Keep this documentation lightweight and useful.

Keep dependencies reasonably up to date and investigate security warnings rather than suppressing or bypassing them.

## 6. Production observability

Build software that can be understood and diagnosed in production.

Provide useful, structured logs, meaningful metrics, and appropriate health signals. Instrument important boundaries and operations so failures, performance problems, and dependency issues can be investigated without guessing.

Prefer actionable signals over excessive telemetry.

Never expose secrets, credentials, personal information, or other sensitive data through logs or other observability mechanisms.

The goal is to make the system diagnosable, not to collect telemetry for its own sake.

## 7. Configuration and environment management

Keep configuration separate from application code when it varies between environments or deployments.

Use the project's established configuration mechanisms rather than inventing a custom system unnecessarily.

Do not hard-code secrets or sensitive environment-specific values into source code.

Manage secrets through appropriate secret-management mechanisms and follow least-privilege principles.

Keep development, testing, staging, and production configuration appropriately separated while avoiding unnecessary differences that make environments difficult to reason about.

## 8. Evolution and upgrades

As the code evolves, prefer changes that allow the existing system to evolve rather than unnecessarily forcing a complete rewrite.

When practical, structure changes so dependencies, schemas, configuration, and other components can be upgraded or migrated incrementally.

Treat this as a design consideration rather than an absolute rule. A rewrite may sometimes be justified; do not add complexity solely to avoid one.

## General principle

Use these practices to produce software that is:

- understandable
- testable
- secure
- maintainable
- observable
- reproducible
- practical to operate and evolve

Prefer established solutions over unnecessary invention, and use engineering judgment rather than following any individual principle mechanically.
