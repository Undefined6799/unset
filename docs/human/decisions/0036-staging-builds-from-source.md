# 0036 — Staging builds its images from the checkout

Status: Accepted by Alex, 2026-10-28 02:04:07Z, against d118587 (the line below, typed in the plan thread). From
here the record changes only to be marked superseded. Departs from P1.37n and P2.26b for staging only; ADR 0033 is
unchanged.

## Context
Staging (VM 315, the `dev` profile of ADR 0025) runs only the images `deployment/images.lock.json` names, by digest:
preflight C2 fails any service with a `build:` key under dev (P1.37n), `npm run dev:up` passes `--no-build`, and the
lock moves only by a reviewed PR after a publish run Alex approves (P2.26b; PLAN.md §2 rule 23, "Never build on the
server", written after two disk-full outages on the old host). So every change to staging is a merge, a publish
approval, a lock-bump PR and a pull on the VM, and nothing can be tried on staging before it is on main.

Alex, 2026-10-23 00:47:01Z, in the project chat (cmsg_01GKYqaAGu4Vob5JHVyDmG7A3xMkBfEHJz7Z8LEUJZrfGq): "accept
P1.27t image-tests on publish BuildKit, just modify staging directly then we can commit and push the changes on the
repo. then once we feel like we have a strong base we can make a production server". Asked whether untested code may
face the internet, 00:48:58Z (cmsg_01GKYqaAGu4Vob5JHVyDmG7A7jwkzCDgvqAJj2352vdXDm): "yes its fine that untested code
face the internet it is isolated in docker on its own vm. not important data will be on staging anyway". The P1.27t
acceptance in the first line is that step's own record; this record takes the rest.

## Decision
1. **Staging may run images built from its checkout.** `npm run dev:source:up` runs the wrapper as
   `--env dev --source` on `deployment/compose.dev.source.yaml`: compose.dev.yaml with its five first-party services
   (postgres, migrate, pds, edge, web) built from the same Dockerfiles the local stack builds, from the same
   contexts, and held to compose.dev.yaml in everything else by a test. Newt stays the mirror's digest. Everything
   else about dev holds: the public names and the file leaf of ADR 0032, the dev network table, no published port,
   Newt as the only way in, the secrets and env files beside the checkout, the C21 waiver.
2. **The preflight judges the build, not a signature.** Under `--env dev --source`, C2 admits a service that builds,
   with no `image:` beside it, when C26 passes the build (a scanned Dockerfile, the workflow's own context, nothing
   reaching the secrets or dev CA folders); a service that names an image must still name a lock digest. C3 to C5
   verify the lock as they do today. The run ends with one fixed line saying the stack is built from the checkout and
   unsigned. Without `--source`, nothing changes: P1.37n's refusals hold, and `--source` with `--env prod` or
   `--env local` is refused.
3. **Production is untouched.** Production deploys only CI-built, keyless-signed, digest-pinned images of merged
   commits (ADR 0033; PLAN.md rule 23; P2.26a). The "deploy only CI-built images" rule in CLAUDE.md and the deployment
   note is scoped to production. Main still changes only by a PR with green CI: what is tried on staging is committed
   and pushed afterwards, through a PR like any other change. The checkout on 315 may run ahead of main meanwhile.
4. **Accepted costs** (Alex, 00:48:58Z). Untested code faces the internet on staging; it is isolated in Docker on its
   own VM, staging is invite-only (ADR 0031) and holds no important data. A build can fill the VM's disk (rule 23's
   outages); a full disk stops staging and nothing else, and the runbook gains a builder-cache prune. A running staging
   no longer tells which commit it is: `git status` and `git log -1` on 315 do.
5. **Scope.** The "no app build on the box" rule is retired for staging only. The runbook's rules on secrets, the
   invite one-off and `down -v` are unchanged. No new secret, variable or port.

## Alternatives
- **Keep the merge, publish, lock-bump, pull loop.** Safe and slow; the loop is what Alex asked to remove for staging.
- **Build on the Mac and push unsigned images to a registry for staging to pull.** A second trust path and a registry
  write from a laptop, for no gain over building where the stack runs.
- **Build on the VM only from a commit on main.** Still a push and a merge per try, which is the wait being removed.
- **A separate dev VM running `local:up`.** Local names and the dev root CA, not the public staging names; it tests a
  different edge than the one Pangolin fronts. The VM thread's other option; this record does not rule it out later.

## Consequences
- A change can be tried on staging in minutes, then committed and pushed; the step book's deploy steps for staging
  (P2.26a's test-host deploy) are unaffected, since they target production shape.
- Staging may run bytes no signature covers; the preflight says so on every run, and the `dev:up` path by lock stays
  available for a release-shaped staging.
- P1.37n's step text records that its C2 rule is narrowed by `--source` under dev only; P1.37y wires it.

## Compliance
P1.37y's tests hold the record: C2 admits a build under dev only with `--source` and refuses it without, `--source`
is refused under prod and local, C3 to C5 are unchanged, the wrapper passes `--build` only under local or `--source`,
the source compose file equals compose.dev.yaml except for the five build blocks, and the final line prints on every
`--source` run (Decisions 1 and 2). ADR 0033 stays accepted and unchanged: it governs what is signed, and nothing here
signs. Acceptance of this record is Alex's typed line naming it and a sha; ADR 0001 gains its one-paragraph entry then.
- Accepted by Alex on 2026-10-28 at 02:04:07Z with the line "accept ADR 0036 at d118587", typed in the plan thread,
  against d118587, the revision #1308 squashed onto main with this text unchanged.
