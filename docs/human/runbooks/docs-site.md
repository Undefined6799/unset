# Docs site (docs.unset.sh)

docs.unset.sh is owned by [unset-sh/docs](https://github.com/unset-sh/docs). Its root owns the Hugo framework,
brand integration and Pages workflow. Organisation repositories own and export their own sections.
[org-0002](https://github.com/unset-sh/agent-kit/blob/d3e3be6da8e693610d51f6bf743082033db4214d/skills/org-decisions/records/org-0002-docs-site-shows-only-organisation-docs.md) excludes this app repository until it moves into `unset-sh`; this repository's `docs/human`
and `docs/site` remain here and continue to be checked in CI.

[ADR 0112](../decisions/0112-app-docs-mirror-retires-at-the-organisation-cutover.md) records the app mirror's retirement. A docs change merged here no longer publishes
to docs.unset.sh. The [retirement procedure](docs-mirror-key.md) must run only after the first real organisation
export and replacement build are green. Preparing or merging this PR does not itself change Pages settings or DNS.

**Who:** Alex coordinates the cutover and owns keys, DNS and Pages settings.

## Publish and diagnose the organisation site

Use the [docs repository's instructions](https://github.com/unset-sh/docs#readme) and its Actions runs. A source
page changes in its owning organisation repository; the site framework changes in `unset-sh/docs`. Check the source
export first, then the docs site's build and deploy. Do not rerun the retired app mirror to repair a failed publish:
it could overwrite the new framework. A failed replacement build leaves the last successful Pages deployment up.

The app's `docs-site` CI job still builds `docs/site` and compares its generated ADR index. For a local build use
[docs/site/README.md](../../site/README.md). This validates the app documentation; it does not publish it.

## Check the cutover and HTTPS

On `unset-sh/docs`, Settings → Pages must use GitHub Actions, the custom domain `docs.unset.sh`, and **Enforce
HTTPS**. Keep the organisation's domain verification in place. Wait for the domain's certificate before enabling
HTTPS enforcement; see [GitHub's HTTPS guide](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
(read 2026-11-22). Domain, certificate and enforcement are live settings, not proved by a green Hugo build.

```sh
dig +short docs.unset.sh CNAME
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://docs.unset.sh/
curl -sSI --max-time 10 http://docs.unset.sh/
```

Expect `unset-sh.github.io.`, HTTPS `200` without bypassing certificate verification, and an HTTP redirect to
`https://docs.unset.sh/`. Open the first real source section and the organisation map; verify that app pages under
`/unset/` are absent. The site remains out of search engines until Alex says otherwise.

The staging edge no longer serves the site (ADR 0111 Decision 6): it serves only the app and the PDS. Remove the
Pangolin `docs.unset.sh` resource once DNS points at Pages.

## The staging edge's leaf

The staging edge's self-signed leaf used to name `docs.unset.sh` too. The after-deploy check in
[dev-stack-secrets.md](dev-stack-secrets.md) now expects exactly the two staging names, so on the first staging
deploy after the docs site left the edge, make the leaf again with that runbook's commands ("The dev edge's
self-signed leaf") before running the check. A leaf that still names `docs.unset.sh` fails the check with
`names are not exactly the two staging names`. The checkout's old `docs/site/public` build can be deleted
(`rm -rf docs/site/public`): nothing reads it any more.
