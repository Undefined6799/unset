# 0075 — The docs site at docs.unset.sh, served by the staging edge

Status: Accepted by Alex, 2026-11-20 05:58Z, against c5e0bfb (his line "Merge 1829 at c5e0bfb", typed in the project
chat after that head was reviewed; merged as eaea7bf). This status paragraph, the index row and the ADR 0001 acceptance
line were added afterwards in #1827. Alex asked on 2026-11-20 at 05:06Z: "lets set it up on docs.unset.sh for now, and
we can configure cd later".

## Context

The docs site (`docs/site`, Hugo with the Hextra theme) is built and checked in CI and served nowhere. The repository
is public, so its text is public already. The staging stack is the one stack that runs, and its edge reaches the
internet only through Pangolin and Newt (ADR 0030 Decision 2, ADR 0032). `docs.unset.sh` is a new public name on our
own domain, so it is a new public surface on the edge, which ADR 0025 and the edge rules (ADR 0046) treat as a
deliberate decision.

## Decision

1. **A third site on the staging edge.** `deployment/edge/dev/docs.caddy` serves `docs.unset.sh` as plain files with
   Caddy's `file_server`: no upstream, no new service, no new port. It binds the edge's `newt_edge` address and uses
   the dev leaf, like the other two staging sites; the leaf gains `docs.unset.sh` as a third name, since Caddy would
   otherwise ask a public CA for one (`modules/caddyhttp/autohttps.go:200-207`), and the runbook's after-deploy check
   expects all three. The production edge and the local stack do not serve it.
2. **The files.** The edge reads the built site from the checkout's `docs/site/public`, one read-only folder bind at
   `/srv/docs`. The folder is kept in git, empty but for `.gitkeep`, so the bind exists on every checkout. Publishing
   is a manual build with the pinned Hugo image (`docs/human/runbooks/docs-site.md`); there is no deploy workflow
   until Alex asks for one. A new build is live at once, with no restart.
3. **Headers.** The usual security headers and `noindex`, as on every staging site, and one CSP:
   `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self';
   manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. Hextra's scripts and
   stylesheet are files on the same origin and its search fetches its index from it, so nothing inline and no eval is
   allowed. The one theme style attribute that mattered (the theme menu's position) moves to
   `docs/site/assets/css/custom.css`; the other, a stroke width on the footer's Hextra logo, is blocked and changes
   nothing visible.
4. **One limit.** `docs_global`, 6000 requests per 5 minutes per address (IPv6 by /64), in memory like every zone.
   A page with no cache is at most 12 requests, so one reader opening a page a second, or twenty readers behind one
   address reading twenty pages each, fit; a flood does not (`limits.budget.test.ts`).
5. **Checks.** The edge rules (`adapted-rules.ts`) allow a file server only on the docs host, rooted at `/srv/docs`,
   and nothing else on that site. C18 accepts exactly that one extra bind, read-only, from `docs/site/public`.
6. **Pangolin and DNS (Alex's).** A Pangolin resource `docs.unset.sh` on the staging site, set up like the other
   two (target `https` to the edge's `newt_edge` address, port 443, certificate check off, TLS Server Name
   `docs.unset.sh`), with Pangolin's login off because the docs are public. A DNS record for `docs.unset.sh` like
   the one `staging.unset.sh` has, pointing at Pangolin.

## Consequences

- Mechanism: Pangolin takes the request, Newt carries it to the edge, the edge counts it in `docs_global` and
  answers from `/srv/docs`. Nothing reaches web, the PDS or the database.
- Risks: anything in the server's `docs/site/public` is published, so only the documented build writes there. A
  broken or old build is visible until the next publish. With the login off, anyone can reach this one site of the
  staging edge. Search engines will not list the docs while they carry `noindex`.
- What still holds: Pangolin routes by host, so the docs resource reaches only the docs site and the login still
  guards the staging app and PDS; the edge still writes no client address; the folder is read-only to Caddy, and
  `file_server` joins every path under its root (Caddy v2.11.9 `SanitizedPathJoin`,
  `modules/caddyhttp/fileserver/staticfiles.go:303`), so no request can name a file outside it; the CSP allows no
  inline script or eval.
- Later: continuous deployment, a production home with indexing, and a cache lifetime for the hashed files are each
  their own change.

## Alternatives

- **GitHub Pages.** Less of our code, and CI already builds the site. It needs a deploy workflow, which is the
  continuous deployment Alex put off, GitHub would see every reader's address, and its response headers, CSP
  included, cannot be set.
- **A separate static-file container behind the edge.** Fits the edge's existing proxied-site rules with fewer rule
  changes, but adds a service when the edge can serve files itself.
- **Serving the docs from web.** Mixes a static site into the app process and its CSP for no gain.

## Compliance

`deployment/edge/adapted-rules.test.ts` holds a red for each docs rule, `edge.test.ts` and `limits.budget.test.ts`
tie the zone to `limits.json`, and `preflight.test.ts` holds the mount's reds. The reviewed config
(`adapted/dev.generated.json`) is proved against the built image by `adapted.image.test.ts`. Acceptance is Alex's
line on the pull request that adds this record.
