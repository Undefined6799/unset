Architecture Instructions

Use these principles when designing, implementing, or modifying this project.

1. Clear responsibilities and boundaries

Keep responsibilities clear and boundaries meaningful.

Prefer:

* high cohesion within modules
* low unnecessary coupling between modules
* clear dependency direction
* small, purposeful contracts
* localized changes
* straightforward testing

Do not split the system into many small modules simply for the sake of elegance. Create a boundary when it clarifies responsibility, isolates change, or represents a meaningful concept.

2. Application concepts come before external technology

Model the application’s concepts and capabilities rather than making external technologies the center of the architecture.

For example:

Application
├── Chat
├── Search
├── Users
└── Dashboard

External systems are implementations behind those concepts:

Matrix → chat implementation
XNG → search implementation
Postgres → user persistence

Keep technology-specific details at the appropriate boundary.

3. Interfaces are contracts, not automatically plugins

Use interfaces to define meaningful contracts between parts of the application.

An interface does not imply that something should be a plugin.

Use plugins only when functionality is intentionally optional, independently extensible, installable, replaceable, or dynamically discovered.

Do not turn ordinary application capabilities into plugins merely because an interface exists.

4. Define the smallest useful contract

Define the contract the application actually needs.

Do not recreate or mirror an external API inside the application’s architecture.

For example, prefer:

interface ChatProvider {
  listConversations(): Promise<Conversation[]>;
  getMessages(id: string): Promise<Message[]>;
  sendMessage(id: string, text: string): Promise<void>;
}

rather than exposing Matrix-specific concepts such as rooms, events, or other provider internals throughout the application.

Translate external concepts at the adapter boundary.

Grow an interface when real application requirements demonstrate that another capability belongs in the contract. Keep interfaces lean and purposeful.

5. Adapters contain external details

Adapters translate between application concepts and external systems.

Conceptually:

Application
    ↓
ChatProvider
    ↓
MatrixChatProvider
    ↓
Matrix

Keep provider-specific details localized so external API changes do not unnecessarily propagate through the application.

6. Dependency direction

Prefer dependencies toward stable application concepts rather than toward external implementation details.

A useful direction is:

UI
 ↓
Application
 ↓
Domain / Contracts
 ↓
Adapters
 ↓
External systems

The core should not depend directly on external technologies unless there is a deliberate reason to do so.

7. Composition versus registries

Use a composition root to wire known, fixed dependencies.

For example:

const chatProvider = new MatrixChatProvider(matrixClient);
const searchProvider = new XngSearchProvider(xngClient);
const app = createApp({
  chatProvider,
  searchProvider,
});

Use registries only when something genuinely needs to be dynamic.

Before introducing a registry, ask:

Does this actually need to be dynamic?

Do not create a registry merely because there are multiple implementations or objects.

8. Cohesion and coupling

Keep responsibilities together when they change for related reasons.

Ask:

Do these things change for related reasons?

When considering a dependency, ask:

If this changes, should the other thing really have to change?

Avoid unnecessary coupling, but do not fragment the system into micro-modules simply to reduce the number of responsibilities per file.

The goal is meaningful boundaries, not maximum fragmentation.

9. Do not go deeper than necessary

Do not create layers unless there is a genuine responsibility or complexity that justifies them.

Avoid unnecessary chains such as:

UserService
    ↓
UserDataManager
    ↓
UserDatabaseService
    ↓
UserPersistenceController
    ↓
PostgresConnectionManager

when the application simply needs:

interface UserRepository {
  findById(id: string): Promise<User | null>;
}

Start with the smallest useful boundary.

Do not invent names, layers, or abstractions for internals that the application does not need to understand.

10. Naming conventions

Use clear, simple, predictable, responsibility-based names.

Names should communicate what something represents, not unnecessary implementation details.

Prefer:

UserRepository
ChatProvider
SearchProvider
PaymentProvider

over unnecessarily technology-specific names in application-level code.

Technology-specific names are appropriate at infrastructure boundaries:

PostgresUserRepository
MatrixChatProvider
XngSearchProvider

Keep filenames and folders consistent with the concepts they contain.

Follow the repository’s established conventions first, then the language’s normal conventions.

When the underlying concept changes, rename things rather than preserving misleading names.

11. Prefer clarity before reuse

Do not abstract code merely because two pieces of code look similar.

Similarity in implementation does not necessarily mean the code represents the same concept or should change together.

A small amount of duplication can be clearer than a premature abstraction.

Use this progression:

First occurrence
    ↓
Keep it simple
Repeated occurrence
    ↓
Observe the pattern
Repeated pattern for the same reason
    ↓
Identify the common concept
Stable common concept
    ↓
Consider extracting a reusable function/module/abstraction

Before extracting something, ask:

1. Are these actually the same concept?
2. Do they change for the same reason?
3. Is the pattern stable?
4. Will the abstraction make the code clearer?
5. Does it reduce meaningful complexity, or merely reduce duplicated lines?

Do not optimize for fewer lines of code. Optimize for clearer concepts and simpler change.

12. Avoid premature abstraction

Do not introduce interfaces, services, registries, event buses, managers, or other abstractions simply because they sound architecturally sophisticated.

Before introducing an abstraction, ask:

What problem does this solve?

and:

What complexity does this introduce?

Prefer the simplest design that adequately represents the current problem.

Let real implementation, repetition, and changing requirements provide evidence for deeper abstractions.

13. Progressive refinement

Do not design the entire architecture in detail before implementation begins.

Start with the important structure and boundaries, then progressively add detail as implementation gets closer and requirements become clearer.

Use the appropriate level of planning for the decision at hand:

Architecture
    ↓
Milestone
    ↓
Feature
    ↓
Implementation slice
    ↓
Test / feedback
    ↓
Refinement

Do not spend significant effort designing hypothetical requirements that may never exist.

14. Architecture is a moving hypothesis

Treat the architecture as the best current understanding of the system, not as something that must remain unchanged.

Use the loop:

Design
  ↓
Implement
  ↓
Observe
  ↓
Learn
  ↓
Refactor
  ↓
Update architecture

Real implementation may reveal that a boundary is unnecessary, misplaced, too complicated, or missing.

When evidence shows that the architecture should change, change it deliberately rather than preserving the original design simply because it was planned first.

15. Reversibility determines design depth

Not every decision deserves the same amount of design effort.

Spend more time thinking about decisions that are expensive or difficult to reverse.

Keep cheap and reversible decisions simple.

For example:

Local helper
→ easy to change
→ keep simple
Internal module boundary
→ moderately reversible
→ design enough to keep responsibilities clear
External provider contract
→ harder to change
→ design deliberately
Core data model
→ potentially expensive to migrate
→ design carefully
Public plugin API
→ difficult to change once adopted
→ design and validate carefully

Use the cost of changing a decision to determine how much design effort it deserves.

16. Coding-agent escalation

Escalate the level of reasoning only when the evidence requires it.

Use this progression:

Small implementation problem
        ↓
Fix locally
Problem repeats
        ↓
Consider refactoring
Problem reveals a boundary issue
        ↓
Reconsider the architecture
Major architectural change
        ↓
Pause for human review

Do not turn every implementation problem into an architectural redesign.

Major changes to core boundaries, public contracts, data models, or other difficult-to-reverse decisions should be surfaced for human review before proceeding.

17. Failure isolation

External providers can fail.

Design boundaries so that a failure in one provider does not unnecessarily crash or destabilize the entire application.

For example:

Dashboard
 ├── Chat → Matrix
 ├── Search → XNG
 └── Other capabilities

If Matrix is unavailable, the chat capability should fail or degrade gracefully without taking down unrelated dashboard functionality.

Surface failures clearly and handle them at the appropriate boundary.

18. Architectural principles are heuristics, not laws

Treat principles such as SOLID, DRY, clean architecture, and similar guidelines as tools for reasoning, not commandments.

Do not introduce abstractions merely to satisfy a principle.

A principle should improve clarity, maintainability, change isolation, or another concrete property of the system.

When following a principle would make the design more complicated without solving a real problem, prefer the simpler design.

The guiding rule is:

Choose the simplest design that keeps responsibilities clear and changes localized.

19. Project structure should communicate the architecture

Organize files and folders around meaningful responsibilities and boundaries.

The repository should read like a map of the system.

Prefer structures that make it easy to answer:

* Where does this responsibility live?
* What does this component depend on?
* Where is the external implementation?
* Where is the contract?
* What changes together?

Do not force a particular folder structure when another structure communicates the actual architecture more clearly.

20. Document important decisions lightly

Maintain lightweight architecture documentation for decisions that would otherwise be difficult to reconstruct.

Document things such as:

* important boundaries
* dependency direction
* major data flows
* architectural trade-offs
* important constraints
* why a significant abstraction exists
* rules around providers and plugins

Do not document every function or duplicate the source code.

Documentation should explain the architecture and the reasons behind important decisions.

21. Verify small changes continuously

The coding agent should work in small, verifiable loops:

Understand
    ↓
Short plan
    ↓
Small implementation slice
    ↓
Format
    ↓
Lint
    ↓
Typecheck
    ↓
Test
    ↓
Diagnose
    ↓
Fix
    ↓
Re-run checks
    ↓
Review diff
    ↓
Next slice

Prefer small changes that can be understood, tested, and reviewed independently.

If repeated implementation problems reveal a structural issue, apply the escalation rules rather than repeatedly patching around it.

22. Protect meaningful architectural decisions

Where practical, turn important architectural rules into automated checks.

For example:

Domain
  → cannot depend on infrastructure
Application
  → can depend on domain
Infrastructure
  → can depend on application/domain

Use formatting, linting, typechecking, tests, and architecture checks to provide automated feedback.

Do not enforce arbitrary rules merely for the sake of enforcement.

Only automate rules that protect meaningful architectural decisions.

23. General decision questions

When making an architectural decision, ask:

1. What responsibility does this component own?
2. What does it need to know?
3. What should it explicitly not know?
4. Which direction should the dependency point?
5. Is this a real boundary or premature abstraction?
6. Does this actually need to be dynamic?
7. If the implementation changes, what else has to change?
8. Can the change remain local?
9. Does the name describe the responsibility or leak implementation details?
10. Is the design understandable from the repository structure?
11. Can an automated check protect this decision?
12. Are we solving a real problem or designing for a hypothetical future?
13. Is this decision cheap or expensive to reverse?
14. Is the abstraction actually clearer than the duplication?

Guiding principle

The overall approach is:

Clear responsibilities
        ↓
Meaningful boundaries
        ↓
Small contracts
        ↓
Concrete adapters
        ↓
Explicit composition
        ↓
Dynamic registries only when justified
        ↓
Simple, responsibility-based naming
        ↓
Clarity before reuse
        ↓
Progressive refinement
        ↓
Evidence-driven architectural change
        ↓
Localized change
        ↓
Automated feedback
        ↓
Continuous refinement

Keep the architecture understandable.

Do not predict the entire future.

Do not add complexity merely because a pattern or principle suggests that you could.

Make the smallest correct change, verify it, learn from the implementation, and evolve the architecture when real evidence shows that it should change.
