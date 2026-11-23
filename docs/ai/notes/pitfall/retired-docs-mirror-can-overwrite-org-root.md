---
id: retired-docs-mirror-can-overwrite-org-root
type: pitfall
status: current
areas: ["[[ci]]", "[[docs]]", "[[deployment]]"]
summary: Remove old mirror runs and the app's credential access before publishing the organisation-owned docs root.
code: [docs/human/runbooks/docs-mirror-key.md, docs/human/runbooks/docs-site.md]
sources: [https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs, https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys]
importance: high
related: ["[[deployment]]"]
replaced_by: null
tags: [pitfall, ci, docs, deployment]
checked: 2026-11-22
---
# Old mirror runs can restore the old docs root

**What goes wrong.** The retired app exporter wrote the docs repository's root README and `.github/`, as well as
`unset/`. Deleting its workflow on main does not revoke its key. A queued run or a rerun of the old commit can still
replace the organisation's framework while that write credential works. GitHub reruns use the original SHA and ref
(GitHub Actions documentation, checked 2026-11-22).

**Rule.** Follow [the cutover runbook](../../../human/runbooks/docs-mirror-key.md): first a real organisation export
and replacement build; then app retirement, no active old runs, owner removal of the app's credential access, and the new framework's
publish. A write deploy key is repository-wide. Never restore the old mirror to repair the new site.

**Decision and recovery.** [ADR 0112](../../../human/decisions/0112-app-docs-mirror-retires-at-the-organisation-cutover.md) records the scope. Restore a damaged docs root
through a reviewed change in `unset-sh/docs`, after the old writer has lost its credential. App docs and their CI
build remain here.
