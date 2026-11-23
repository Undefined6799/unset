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

The staging-edge removal is separate ([app PR #1985](https://github.com/Undefined6799/unset/pull/1985)). The legacy
procedures below apply only while the old edge still serves the domain. Do not use them to republish the app after
the organisation cutover or reverse its DNS change.

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
