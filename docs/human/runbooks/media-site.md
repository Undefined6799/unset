# Media site (staging.usercontent.unset.site)

The staging edge serves the media process at `https://staging.usercontent.unset.site` (ADR 0029; book P2.19).
Until the real safety scan is live (P5.07b) it serves only `/o/*`: five-minute signed links to a tester's own draft
pictures, which the editor shows as previews. Everything else on that host is dropped at Pangolin. The media process
runs only on the stack built from source (`compose.dev.source.yaml`); the image stack's edge has the site but
answers 502 there.

**Who:** Alex, at the deSEC and Pangolin dashboards and on the staging host. Do the steps in this order: the
Pangolin log setting must be off, and its stored rows purged, before the resource exists, or Pangolin keeps every
preview link with its signature (ADR 0029, `server/routers/badger/logRequestAudit.ts:158-163, 216-221` at 1.24.0).

## Once, in order

1. **Accept ADR 0029.** A typed line in the pull request thread, the one the coordinator gives you.
2. **Allow the `.site` name.** On pull request #1853, the typed line:
   `yes shared/http/config.ts KNOWN_TLDS add .site for the media domain unset.site`.
   Web refuses to start with a `.site` media origin until it merges.
3. **Approve this edge site.** It is a trusted-base edge change, so it merges on your typed line naming its head.
4. **Pangolin: stop the request log.** In Pangolin, open the staging organization's settings, find the request
   log (audit log) retention, and set it to `0`. Wait at least six minutes (Pangolin caches the setting for 300
   seconds and writes in 5-second batches), then purge the organization's stored request-log rows. The setting is
   org-wide, so it also stops logging the app's `/oauth/callback` codes.
5. **Pangolin host: no query strings in the proxy's access log.** If the Traefik access log is on in Pangolin's
   `config/traefik/traefik_config.yml`, drop the request path from it (`accessLog.fields.names.RequestPath: drop`,
   Traefik's `accessLog.fields` setting; not yet checked against the host's Traefik version) and restart Traefik. If
   the access log is off, nothing to do.
6. **DNS on deSEC** (desktop: deSEC, Domains, `unset.site`, add records under the subname `staging.usercontent`).
   Give `staging.usercontent.unset.site` the same set `staging.unset.sh` has (ADR 0032 Decision 4: staging has no
   `dns-01` CAA line and no `_acme-challenge` CNAME):
   - `A`: the same value as `staging.unset.sh` (the Pangolin host). No `AAAA`, as `staging.unset.sh` has none.
   - Three `CAA` records:
     `0 issue "letsencrypt.org; validationmethods=http-01"`,
     `0 issuewild ";"`,
     `0 iodef "mailto:security@unset.sh"`.

   The apex `unset.site` and `usercontent.unset.site` (production, later) stay parked. Nothing that signs anyone in
   ever goes on an `unset.site` name (ADR 0029).
7. **Pangolin resource** (desktop: Pangolin, the staging organization, Resources, Add Resource):
   - Name and domain `staging.usercontent.unset.site`, on the staging site.
   - One target: `https`, `10.250.37.3`, port `443`, certificate check off for the target, **TLS Server Name**
     `staging.usercontent.unset.site` (as for the docs resource, `docs-site.md`). Pangolin sends no SNI to an IP
     target without it, and the edge refuses a handshake without one (ADR 0032 Decision 5).
   - Authentication: every method off (no platform login, no password, no PIN, no email list). A browser never
     sends Pangolin's `SameSite=Lax` cookie with an image on another site, so a login would block every preview.
   - Rules: turn rules on and add exactly two, never an Accept rule:
     1. Pass, path `/o/*`, priority 1 (the higher one).
     2. Drop, path `/*`, priority 2.
8. **Staging host: the media secrets.** In `unset-dev-secrets/`, `draft_url_keyring` (web already needs it) and
   `objects_media` with media's read-only identity, as `dev-stack-secrets.md` gives them ("The web server's two
   files" and "Media's identity (P2.19)").
9. **Staging host: the media origin.** In `unset-dev-env/dev-public.env`, set
   `WEB_MEDIA_ORIGIN=https://staging.usercontent.unset.site`.
10. **Staging host: remake the dev leaf** with `staging.usercontent.unset.site` as its fourth name, as
    `dev-stack-secrets.md` ("The dev edge's self-signed leaf") now gives it. Caddy asks a public CA for any site
    name the leaf does not cover (Caddy v2.11.9 `modules/caddyhttp/autohttps.go:200-207`), which the staging edge
    must never do.
11. **Deploy from source** from a checkout with the merged media pull requests, then run the after-deploy check in
    `dev-stack-secrets.md` and the checks below.

## Check

```sh
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://staging.usercontent.unset.site/o/x
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://staging.usercontent.unset.site/b/x
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://staging.usercontent.unset.site/
```

The first reaches media and prints its refusal of an unsigned link (`404`, with media's sandbox policy on it). The
second and third are dropped at Pangolin and print Pangolin's denial, never a media answer. Then, signed in on
`https://staging.unset.sh`, add a picture to a draft card: its preview loads, and after five minutes the same link no
longer does. `staging.unset.sh` and `staging.unset.ac` still ask for the staging login.
