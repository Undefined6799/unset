# Docs site (docs.unset.sh)

The staging edge serves the built docs site at `https://docs.unset.sh` (ADR 0075). It reads the files from the
checkout's `docs/site/public` folder, mounted read-only at `/srv/docs` (`deployment/compose.dev.yaml`). Publishing is
a manual build on the staging host; there is no deploy workflow yet. A new build is live as soon as it finishes: the
edge needs no restart.

**Who:** Alex, on the staging host.

## Once: DNS and Pangolin

1. **DNS.** Add a record for `docs.unset.sh` of the same type and value as the one `staging.unset.sh` has, so it
   points at Pangolin. Pangolin gets its own Let's Encrypt certificate for it; the CAA records already allow
   `letsencrypt.org`.
2. **Pangolin.** Add a resource `docs.unset.sh` on the staging site, set up like the two staging resources
   (`docs/human/runbooks/dev-stack-secrets.md`, "Newt's env file"): one target, `https` to `10.250.37.3` port 443,
   certificate check off for the target, **TLS Server Name** `docs.unset.sh`. Turn the resource's login off: the docs
   are public, in the repository already. Pangolin sends no SNI to an IP target without the TLS Server Name, and the
   edge refuses a handshake without one (ADR 0032 Decision 5).
3. Deploy the stack from a checkout that has this change (the edge gains the docs site and the folder bind), then
   publish once, below.

## Each time: publish

From the repository root on the staging host, after `git pull`:

```sh
git clean -fdX docs/site/public
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --entrypoint hugo -v "$PWD:/project" -w /project/docs/site ghcr.io/gohugoio/hugo:v0.168.0@sha256:1fb8fe7f417abd5802d86747d297728aa48078d763159e7dff6559fe3f8bb8e7 build --gc --minify --panicOnWarning
```

The first line empties the build folder of everything git ignores, so a page removed from the docs does not linger;
it keeps `.gitkeep`, which the edge's bind needs (C18). The second is the pinned build from `docs/site/README.md`,
run as your own user so the files belong to the checkout's owner (C9 judges the bind's owner and modes), with the
container's `/tmp` as home so Hugo can keep its cache and the theme module there. The site is down for the few
seconds between the two lines.

CI's `docs-site` job runs the same build the same way on every pull request.

## Check

```sh
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://docs.unset.sh/
curl -sSI --max-time 10 https://docs.unset.sh/ | grep -i '^content-security-policy'
```

The first prints `200`. The second prints the docs site's policy, which starts `default-src 'none'; script-src 'self'`.
A `404` on every page means the folder is empty: publish again.
