# Docs site (docs.unset.sh)

docs.unset.sh is GitHub Pages on the docs repository, [unset-sh/docs](https://github.com/unset-sh/docs), built by
that repository's `site` workflow on every push (ADR 0111). The workflow and the site are written here
(`deployment/docs-repo/site.yml`, `docs/site`) and copied there by `docs-mirror.yml`
([docs-mirror-key.md](docs-mirror-key.md)), so a docs change merged to main is live a few minutes later with no step
by hand.

Until the DNS record in "Once: GitHub Pages" below points at Pages, the staging edge still serves the site from a
manual build (ADR 0075): the three sections after it describe that, and go when the edge's docs site does.

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
7. **Pangolin.** Remove the `docs.unset.sh` resource. The edge's docs site, its limit and its folder bind are removed
   by the change that follows this one (ADR 0111 Decision 6).

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

## The staging edge, until DNS moves

The staging edge serves the built docs site at `https://docs.unset.sh` (ADR 0075). It reads the files from the
checkout's `docs/site/public` folder, mounted read-only at `/srv/docs` (`deployment/compose.dev.yaml`). Publishing is
a manual build on the staging host. A new build is live as soon as it finishes: the edge needs no restart.

## Once: DNS and Pangolin (staging edge)

1. **DNS.** Add a record for `docs.unset.sh` of the same type and value as the one `staging.unset.sh` has, so it
   points at Pangolin. Pangolin gets its own Let's Encrypt certificate for it; the CAA records already allow
   `letsencrypt.org`.
2. **Pangolin.** Add a resource `docs.unset.sh` on the staging site, set up like the two staging resources
   (`docs/human/runbooks/dev-stack-secrets.md`, "Newt's env file"): one target, `https` to `10.250.37.3` port 443,
   certificate check off for the target, **TLS Server Name** `docs.unset.sh`. Turn the resource's login off: the docs
   are public, in the repository already. Pangolin sends no SNI to an IP target without the TLS Server Name, and the
   edge refuses a handshake without one (ADR 0032 Decision 5).
3. **The dev leaf.** Remake the edge's self-signed leaf with `docs.unset.sh` as its third name, as
   `dev-stack-secrets.md` ("The dev edge's self-signed leaf") now gives it, before the deploy below. Caddy asks a public
   CA for a certificate for any site name the loaded leaf does not cover (Caddy v2.11.9
   `modules/caddyhttp/autohttps.go:200-207`), which the staging edge must never do (ADR 0032 Decision 1).
4. Deploy the stack from a checkout that has this change (the edge gains the docs site and the folder bind), then
   publish once, below.

## Each time: publish (staging edge)

From the repository root on the staging host, after `git pull`:

```sh
git clean -fdX docs/site/public
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e HUGO_CACHEDIR=/tmp/hugo_cache --entrypoint hugo -v "$PWD:/project" -w /project/docs/site ghcr.io/gohugoio/hugo:v0.168.0@sha256:1fb8fe7f417abd5802d86747d297728aa48078d763159e7dff6559fe3f8bb8e7 build --gc --minify --panicOnWarning
```

The first line empties the build folder of everything git ignores, so a page removed from the docs does not linger;
it keeps `.gitkeep`, which the edge's bind needs (C18). The second is the pinned build from `docs/site/README.md`,
run as your own user so the files belong to the checkout's owner (C9 judges the bind's owner and modes), with home and
Hugo's cache (`HUGO_CACHEDIR`, which the image sets to a folder only its own user may write) in the container's
`/tmp`, where Hugo downloads the theme module. The site is down for the few
seconds between the two lines.

CI's `docs-site` job runs the same build the same way on every pull request.

## Check (staging edge)

```sh
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://docs.unset.sh/
curl -sSI --max-time 10 https://docs.unset.sh/ | grep -i '^content-security-policy'
```

The first prints `200`. The second prints the docs site's policy, which starts `default-src 'none'; script-src 'self'`.
A `404` on every page means the folder is empty: publish again.
