# Docs site (docs.unset.sh)

docs.unset.sh is GitHub Pages on the docs repository, [unset-sh/docs](https://github.com/unset-sh/docs), built by
that repository's `site` workflow on every push (ADR 0111). The workflow and the site are written here
(`deployment/docs-repo/site.yml`, `docs/site`) and copied there by `docs-mirror.yml`
([docs-mirror-key.md](docs-mirror-key.md)), so a docs change merged to main is live a few minutes later with no step
by hand.

The staging edge no longer serves the site (ADR 0111 Decision 6): it serves only the app and the PDS.

**Who:** Alex.

## Once: GitHub Pages

Do these after the first copy has landed in unset-sh/docs, in this order. The custom domain is added before the DNS
record so that nobody else can claim the name in between (github/docs,
`content/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site.md`).

1. **Source.** On unset-sh/docs: Settings, Pages, "Build and deployment", Source: **GitHub Actions**. Choose none of
   the suggested workflows: ours is already there as `.github/workflows/site.yml`.
2. **First publish.** Actions tab, `site`, re-run the latest run (or "Run workflow"). A run from before step 1 failed
   in its deploy job without effect. When it is green the site is at `https://unset-sh.github.io/docs/`, without
   styles, because every address in it is written for docs.unset.sh.
3. **Verify the domain for the organisation.** Organisation unset-sh: Settings, Pages, "Add a domain", `unset.sh`. Add
   the TXT record it shows (`_github-pages-challenge-unset-sh.unset.sh`) at the DNS host, then Verify. From then on
   only the organisation's repositories can publish to `unset.sh` and its subdomains, which is what stops a takeover
   if the Pages site is ever switched off while the DNS record stays.
4. **Custom domain.** On unset-sh/docs: Settings, Pages, "Custom domain", `docs.unset.sh`, Save. With a workflow as
   the source no `CNAME` file is needed.
5. **DNS.** Replace the `docs.unset.sh` record that points at Pangolin with a `CNAME` to `unset-sh.github.io`.
   GitHub then asks Let's Encrypt for the certificate; the CAA records already allow `letsencrypt.org`.
6. **HTTPS.** When Settings, Pages shows the DNS check passed and the certificate issued, tick **Enforce HTTPS**.
7. **Pangolin.** Remove the `docs.unset.sh` resource. The edge's own docs site is gone from this repository (ADR 0111
   Decision 6); see "The staging edge's leaf" below for the one step its deploy needs.

The `github-pages` environment that GitHub creates deploys from the default branch only. Leave it so.

## Check (GitHub Pages)

```sh
dig +short docs.unset.sh CNAME
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://docs.unset.sh/
curl -sS --max-time 10 https://docs.unset.sh/ | grep -o '<meta name=robots[^>]*>'
```

The first prints `unset-sh.github.io.`, the second `200`, the third `<meta name=robots content="noindex, nofollow">`:
the site stays out of search engines until Alex says otherwise.

## When the site did not update

Look at the newest commit on unset-sh/docs. If it is not the copy of your change, the `docs-mirror` run here failed
([docs-mirror-key.md](docs-mirror-key.md), "When a run fails"). If it is, open the `site` run there: a red build job
names the page Hugo refused, and the last good site stays up until a fix is copied.

## The staging edge's leaf

The staging edge's self-signed leaf used to name `docs.unset.sh` too. The after-deploy check in
[dev-stack-secrets.md](dev-stack-secrets.md) now expects exactly the two staging names, so on the first staging
deploy after the docs site left the edge, make the leaf again with that runbook's commands ("The dev edge's
self-signed leaf") before running the check. A leaf that still names `docs.unset.sh` fails the check with
`names are not exactly the two staging names`. The checkout's old `docs/site/public` build can be deleted
(`rm -rf docs/site/public`): nothing reads it any more.
