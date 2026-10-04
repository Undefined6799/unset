# Engineering Workflow & Change Management

## 1. Change Management

Before making significant changes, understand the existing implementation, conventions, dependencies, and constraints.

Keep changes focused, incremental, and easy to review. Avoid mixing unrelated changes in the same change set.

Prefer the smallest change that correctly solves the problem while preserving existing behavior unless the change explicitly requires otherwise.

Before considering work complete:
- Review the resulting diff.
- Check for unintended changes.
- Remove unnecessary complexity or unrelated modifications.
- Confirm existing behavior has not been accidentally broken.
- Ensure new code follows established project conventions.

Do not make broad refactors merely because you are touching an area of code. Separate necessary improvements from unrelated cleanup unless the cleanup is small and clearly beneficial.


## 2. Git Discipline

Treat version control as part of the engineering workflow.

- Keep commits focused and logically coherent.
- Do not mix unrelated features, refactors, formatting changes, or fixes unnecessarily.
- Review diffs before committing.
- Do not commit generated files, secrets, credentials, local configuration, or other unintended artifacts.
- Preserve useful project history.
- Write commit messages that clearly communicate the purpose of the change.
- Do not rewrite or discard existing history unless explicitly requested.
- Do not use destructive Git operations casually.

When investigating a problem, use Git history when it can provide useful context rather than assuming the current implementation tells the whole story.


## 3. Codebase Reconnaissance

Before introducing a new pattern, dependency, abstraction, or subsystem, inspect the existing codebase.

Look for:
- Existing implementations solving similar problems.
- Established naming and structural conventions.
- Existing utilities or shared components.
- Existing dependencies that already provide the required capability.
- Existing tests and test patterns.
- Configuration and deployment conventions.
- Relevant architectural boundaries.

Prefer extending or reusing an existing approach when appropriate.

Do not create a second mechanism for something the project already handles well without a clear reason.


## 4. API and Contract Design

When designing APIs or external contracts:

- Keep contracts clear, minimal, and intentional.
- Validate inputs at trust boundaries.
- Use consistent error behavior.
- Avoid exposing internal implementation details unnecessarily.
- Prefer backwards-compatible evolution when practical.
- Consider idempotency where operations may be retried.
- Design pagination, filtering, and resource boundaries deliberately where applicable.
- Translate external API concepts into internal domain concepts at appropriate boundaries rather than allowing external models to spread throughout the system.

Do not design elaborate versioning or compatibility machinery without a real requirement.


## 5. Database and Data Modeling

Treat persistent data as a long-lived contract.

- Model data around actual domain needs.
- Use appropriate constraints and indexes.
- Preserve data integrity through database constraints where appropriate.
- Treat migrations as deliberate changes to a production system.
- Consider existing data, deployment order, rollback implications, and compatibility when changing schemas.
- Avoid destructive migrations unless explicitly required and safely planned.
- Keep application and database assumptions consistent.
- Test important migration and data-transition paths.

Prefer simple, understandable schemas over clever designs.


## 6. Performance

Treat performance as an engineering concern, but do not optimize based on speculation.

Prefer:

Measure → identify the bottleneck → make a targeted change → measure again.

- Avoid premature optimization.
- Consider algorithmic complexity and obvious performance risks during design.
- Profile or measure meaningful workloads when performance matters.
- Optimize real bottlenecks rather than arbitrary code.
- Consider database queries, network calls, I/O, memory usage, concurrency, and external dependencies where relevant.
- Preserve readability unless the performance improvement justifies additional complexity.

Performance improvements should be evidence-driven.


## 7. Documentation

Documentation should explain things that are important to understand, operate, or change.

Keep documentation:
- Accurate.
- Concise.
- Close to the relevant code when appropriate.
- Updated when behavior, configuration, architecture, or operational procedures change.

Document why when the reasoning is not obvious.

Avoid documenting implementation details that are already clear from well-written code.

Important architectural and dependency decisions should be documented lightly rather than buried in comments or left entirely implicit.


## 8. Higher-Risk Changes

For changes that affect persistent data, external contracts, deployment, infrastructure, or other systems outside the immediate code:

Increase the level of planning and verification proportionally to the risk and reversibility of the change.

Consider:
- Existing consumers.
- Existing data.
- Deployment order.
- Compatibility.
- Failure and recovery behavior.
- Rollback or migration strategy.
- Operational impact.
- Security implications.

Do not apply heavyweight planning to routine, reversible changes.


## 9. General Change Principle

Prefer changes that are:

Small → understandable → testable → reversible → easy to review.

When a change becomes difficult to reason about, stop and reassess the design rather than continuing to add complexity.

The goal is not to minimize the number of files, abstractions, commits, or lines changed.

The goal is to make correct changes with controlled complexity and clear reasoning.
