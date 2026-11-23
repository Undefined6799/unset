---
status: Proposed
date: "2026-11-22"
step: P1.21t
supersedes:
  - adr: "0111"
    part: "Decisions 1 to 3 and 5: app export and ownership of the docs framework"
---
# 0112 — The app stops publishing at the organisation docs cutover

## Context

[ADR 0111](0111-docs-gathered-in-one-repository-and-served-by-pages.md) records the first publisher: this app sends
its human documentation and Hugo site to `unset-sh/docs`, including that repository's root README and Pages
workflow. A later run can therefore overwrite a framework maintained directly in the docs repository.

The accepted organisation decision [org-0002](https://github.com/unset-sh/agent-kit/blob/d3e3be6da8e693610d51f6bf743082033db4214d/skills/org-decisions/records/org-0002-docs-site-shows-only-organisation-docs.md) records Alex's 2026-11-22 choice: "I want it to be from the
organisation docs only" and "Keep it up until replaced". This app remains outside `unset-sh`. In the docs rebuild
chat on 2026-11-22, Alex then authorised the described deployment and mirror-retirement sequence with "do that",
and asked to "also make sure https is active". This record applies that scope here; it does not declare an unrun
cutover complete. ADR 0111 remains unchanged as the earlier record.

## Decision

1. Remove the app's `docs-mirror` workflow, exporter, their dedicated tests and `deployment/docs-repo/` copies of
   the docs repository's root files. The app does not publish a section to docs.unset.sh while outside the org.
2. Keep `docs/human/`, `docs/site/`, the app's `docs-site` CI build and its generated-documentation checks. The
   documentation remains available in this repository. The organisation site's framework is maintained in
   `unset-sh/docs`; organisation repositories own their sections.
3. Merge the retirement only after a real organisation source export and the replacement site build are green.
   Keep the last published site available until the replacement deploy succeeds. Cancel or finish older mirror
   runs and have Alex remove the app's access to its write credential before publishing the new root framework.
   Delete the retired environment; revoke an app-only key, or preserve a key Alex explicitly transferred to the
   first organisation source. The detailed sequence is in [the runbook](../runbooks/docs-mirror-key.md).
4. Verify the replacement over HTTPS and enable Pages HTTPS enforcement. DNS and Pages settings, key handling,
   and the separate staging-edge removal remain owner operations. This change performs none of them.
5. Adding app documentation later requires the app's move into `unset-sh` and the then-current source export
   contract. Do not restore this legacy root-writing exporter.

## Alternatives

- Keep the app mirror until after the new framework is deployed. A concurrent or rerun old job could restore the
  old root workflow and README; choose an ordered cutover instead.
- Delete the app's local documentation and Hugo validation too. This would remove useful repository documentation
  and checks without being needed for the organisation-only site; keep them.
- Stop the old site before the first organisation source is ready. This would leave a gap, contrary to org-0002;
  keep the existing deployment until the replacement is ready.

## Consequences

App documentation changes no longer automatically appear on docs.unset.sh. The app loses its long-lived write
credential to the docs repository after owner cleanup. No data, app runtime, image, database or edge configuration
changes. The dedicated tests leave with the implementation they tested; shared guards remain.

Removing a workflow file does not revoke its deploy key. An old rerun uses its original commit and ref
([GitHub Actions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs), read
2026-11-22), so the run and credential checks are part of cutover, not proof supplied by this diff. Reverting this
PR alone cannot restore publication after key revocation. A rollback needs coordination with `unset-sh/docs`.

## Compliance

Run `npm run check` with the pinned Node version, build the retained Hugo site with the CI command and compare its
ADR index. Review the diff for exactly the retired publisher and its operational references; no shared workflow
guard is loosened. The live acceptance evidence is the first real source export, no active old mirror run, the
retirement merge, owner credential cleanup, a successful replacement deployment and verified HTTPS enforcement.
