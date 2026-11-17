# 0057 — "Small and auditable" means our code; established packages are used, not rebuilt

Status: Accepted by Alex, 2026-11-17 22:44:29Z, against 15991f1 (his line "Accept ADR 0057 at 15991f1", typed in
the project chat after the coordinator had reviewed that head). The only changes since that head are this status
paragraph, the index row and the ADR 0001 acceptance line. Alex chose the direction on 2026-11-17 22:36Z in the
project chat, answering the review of hand-built tooling. It amends engineering rule DO-1 (adopted by ADR 0002) and the D8 line of `CLAUDE.md`, and gives
plan §9 its meaning. No earlier record is edited.

## Context
Plan §9 is headed "How we keep it small and auditable". Three rules were read together as "use few packages":
§9 itself, DO-1's "a runtime dependency or service" gets its own ADR, and the practice that every ADR waits for
Alex's typed line. Writing code costs an agent almost nothing, so the cheaper path was always to write it ourselves.
The code shows it in its own comments:

- `deployment/preflight/checks/der.ts` walks X.509 DER by hand because "the lockfile holds no ASN.1 parser".
- ADR 0015 judged the web stack by the glue it needed (about 150 lines, `scripts/budgets/count-glue-lines.ts`), so the
  cost moved into a hand-built component kit, token build, island runtime and budgets (about 11k lines with their tests under
  `shared/ui`, `shared/ui-build`, `shared/islands` and `scripts/budgets`), which is now being replaced by Svelte and
  shadcn-svelte.
- On main at 7e61397 our product code (`apps`, `domains`, `interfaces`, `infrastructure`) is about 14k source lines;
  `scripts` and `deployment` are about 17k source lines plus about 32k lines of tests.

That reading contradicts what Alex meant and what the Engineering Practices Addendum §5 already says: "Use
established libraries and dependencies when they solve a real problem well. Do not reinvent proven solutions
unnecessarily." Alex, 2026-11-17: by small he meant the code, kept at the size it should have, with no code written
for no reason; by auditable he meant easy to read and follow, with an architecture that makes sense.

## Decision
1. **Small** is measured in the code we own and must maintain, not in the number of packages. We write code only for
   what is ours to decide (product rules, our security checks, the glue between parts). Where an established,
   maintained package or a platform feature already solves the problem, we use it instead of writing our own.
2. **Auditable** means a reader can follow the code and see why the architecture is shaped as it is: clear folders and
   boundaries, security code that reads as an ordered list of checks, and reasons written down where they are not
   obvious. A smaller package count does not make code auditable; less code of our own, read more easily, does.
3. **The dependency bar.** A new package, runtime or dev, needs no ADR when its pull request shows, in "What I am
   unsure about", that it meets every point below:
   - it is the established choice for its problem: widely used, or the one the framework we use recommends;
   - it is maintained: a release in the last 12 months, an organisation or more than one maintainer behind it, and
     no deprecation notice;
   - it is not likely to be dropped: not in maintenance-only mode, no announced successor; where an ecosystem is
     moving, we take the package it is moving to (Alex's caution);
   - its licence passes the licence check, it is pinned exactly with an integrity hash (the dependencies guard), it is
     past Renovate's 7-day minimum release age, and `audit` is green;
   - the PR names what it replaces or saves us from writing, and how many packages it adds to the lockfile.
4. **A full ADR is still needed** for a package that handles authentication, sessions or tokens; cryptography or
   signing; outbound requests (anything `net-guard` classifies); or personal data. The same holds for a new service
   or process, as DO-1 already says.
5. **Unchanged:** `pds-admin` and `chat-admin` stay free of third-party packages, and their allowlist changes only with
   Alex's approval; a vendor SDK is imported in exactly one adapter folder; domains import no npm package beyond the
   one record validator; patched upstreams stay forbidden (plan §9).
6. **What we already built** is not rewritten for its own sake. A hand-built piece is replaced when a maintained tool
   does the same job and the change is cheaper than keeping it, or when the piece is next changed in a real way.
   Reviews list candidates; each replacement is its own PR.

## Alternatives
- **Keep the rule as it is** (an ADR and Alex's line for every runtime package). It is what produced the hand-built
  code above, and it spends Alex's attention on choices the bar settles.
- **Allow any package with no bar.** Loses the supply-chain care the plan asks for: exact pins, release age, audit,
  licence, and the check that a package is not about to be abandoned.
- **A machine-checked bar** (a guard that reads download counts, release dates and maintainers). It needs network
  access in CI and is its own code to own; the points are easy for a reviewer to check in the PR text.

## Consequences
- Agents reach for an established package first and say why in the PR; Alex is asked only for the security-relevant
  kinds in decision 4.
- The lockfile grows; exact pins, Renovate's release age, `audit`, the licence check and the integrity guard keep it
  watched.
- Later reviews look for hand-built code with a maintained replacement (the DER reader, parts of the release and
  deploy tooling) and propose each one on its own.

## Compliance
Review, against the PR template: the "What I am unsure about" field states the bar or names the ADR. The dependencies
guard (`scripts/guards/dependencies.ts`), the licence check and `audit` keep checking every package as before. No new
guard.
