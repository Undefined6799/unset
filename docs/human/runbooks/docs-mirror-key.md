# Retire the app's docs mirror and deploy key

The app publisher is retired by [ADR 0112](../decisions/0112-app-docs-mirror-retires-at-the-organisation-cutover.md), implementing the accepted
[org-0002](https://github.com/unset-sh/agent-kit/blob/d3e3be6da8e693610d51f6bf743082033db4214d/skills/org-decisions/records/org-0002-docs-site-shows-only-organisation-docs.md). This is a cutover procedure, not instructions to set up a new app mirror.

**Who:** Alex. No private key needs to be read, copied or given to an agent.

## Before merging the retirement

1. Confirm at least one `unset-sh` repository has exported real pages to `unset-sh/docs`, and the replacement
   framework builds those pages successfully. A fixture or local preview is not an export.
2. Record the last successful Pages deployment and the reviewed framework commit. Keep the existing public site
   serving until the replacement can publish.
3. Merge the app retirement only as part of that coordinated cutover. The app's `docs/human` and `docs/site` stay in
   this repository; app CI continues to validate them.

## Stop the old writer before publishing the replacement

1. After the retirement merge, cancel any queued or running `docs-mirror` runs from older commits here. Verify none
   remains active. Do not rerun an old mirror run.
2. Remove this app's access to the write credential. In this app repository → Settings → Environments, delete the
   retired `docs-mirror` environment, including its `DOCS_DEPLOY_KEY` secret. Do not display or export the value.
3. In `unset-sh/docs` → Settings → Deploy keys, delete the key titled `Undefined6799/unset docs-mirror` if it belongs
   only to this app. If Alex explicitly transferred that key to the first organisation source, preserve its
   destination key and verify the app no longer has its secret. Do not delete another source's key.
4. Publish the reviewed docs framework with the app's legacy `unset/` tree removed. Verify HTTPS and real source
   pages using [docs-site.md](docs-site.md). Record the source export, retirement merge and successful deployment.

A deletion on main does not revoke a credential. GitHub reruns use the original commit and ref; the old exporter
owned `unset/`, the root `README.md` and `.github/`, so an old run could put the legacy framework back. GitHub's
[rerun documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
and [deploy-key documentation](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
were checked on 2026-11-22. A write deploy key authorises the repository, not a single source folder.

## Recovery

If the replacement build or deploy fails, diagnose it in `unset-sh/docs`; the last successful Pages deployment
continues serving. Do not restore the app mirror or recreate its key to fix the organisation site. Reverting this
code change alone does not restore a revoked key. Returning to the old publishing model needs a new owner decision
and a coordinated rollback of the docs repository.

If an old mirror already overwrote the framework, remove its credential access first, then restore the reviewed framework and
source trees by a reviewed change in `unset-sh/docs`. Keep the app's documentation readable in this repository.
