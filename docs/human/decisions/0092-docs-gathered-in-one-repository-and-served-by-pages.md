---
status: Proposed
date: "2026-11-21"
step: P1.21t
supersedes:
  - adr: "0075"
---
# 0092 — Human docs are gathered in one docs repository, and docs.unset.sh is GitHub Pages built from it

Alex asked on 2026-11-21 (20:25Z to 20:29Z) for one documentation pipeline across our repositories: each repository
keeps its docs beside its code, and "whenever the documentation for human is updated", its own CI/CD "will send it to
that other repo automatically", "where everything is aggregated", and the website is built from there, so that
nothing drifts and it is "easy to work across all these repos". At 20:38Z he chose where the site is served: "GitHub
Pages on the docs repo".

## Context

docs.unset.sh is built from this repository alone (`docs/site`, Hugo with the Hextra theme) by a manual build on the
staging host, and served by the staging edge (ADR 0075, which put continuous deployment off). The organisation
`unset-sh` is getting repositories of its own (`lexicons`, ADR 0089; later more), each with documentation a reader
expects to find in that repository and on the one site.

The site and this repository's checks are tied together: `scripts/docs/` generates and compares the settings,
endpoint and ADR index pages against the code, and CI builds the site with `--panicOnWarning`. So the site itself
stays decided here for now, as the lexicons do (ADR 0089).

GitHub gives a deploy key write access to one whole repository, never to one folder of it (github/docs,
`content/authentication/connecting-to-github-with-ssh/managing-deploy-keys.md`, read 2026-11-21).

## Decision

1. **`unset-sh/docs` gathers the docs; nothing is written there by hand.** Every source repository owns one top
   folder, named after the repository, and that folder is a copy of its human documentation. This repository's
   folder is `unset/`: `docs/human` as `unset/human` and `docs/site` as `unset/site`, the files git tracks and
   nothing else (`scripts/ci/docs-export.ts`). `docs/ai` is working material and is not sent.
2. **Each source pushes its own folder, from its own CI.** Here that is `docs-mirror.yml`: on a push to main that
   changes what is copied, it replaces `unset/` in the docs repository and pushes one commit that links its source
   commit. It removes and stages its own paths by name, so no other folder can change. It never force-pushes. When
   another source pushed first, it replays its one commit on top and pushes again, three times at most; a replay
   that does not apply cleanly, or a third refusal, fails the run.
3. **While the site is decided here, this repository also owns the docs repository's own files**: its `README.md`
   and its Pages workflow. They live in `deployment/docs-repo/` and travel with the same push.
4. **One deploy key per source repository.** Its public half is on `unset-sh/docs` with write access; its private
   half is the secret `DOCS_DEPLOY_KEY` of an environment `docs-mirror` in the source repository, whose only
   deployment branch is `main`. Alex makes each pair and places both halves by hand; no agent or thread ever holds a
   private half. A key per source means one source can be cut off without touching the others.
5. **docs.unset.sh is GitHub Pages on `unset-sh/docs`, built by a workflow there on every push**
   (`deployment/docs-repo/site.yml`). It builds `unset/site` with the Hugo image CI pins here, with each other
   source's folder copied in as a section of the site under the folder's name, and deploys the result. A folder
   named like an existing section, a link anywhere, or a build warning fails the run and publishes nothing. The
   staging edge stops serving the docs. This supersedes ADR 0075.
6. **Two changes.** The pull request that adds this record carries the copy and the Pages workflow. A second one,
   once DNS points at Pages, takes the docs site, its limit zone and its folder bind off the staging edge. Until
   then the edge keeps serving the manual build as ADR 0075 describes.
7. **The site stays out of search engines until Alex says otherwise**, as it is today.

## Consequences

- **Mechanism.** A docs change merged to main here is copied to `unset-sh/docs` within the run, and the push there
  builds and publishes the site. No step is done by hand and no server of ours is involved.
- **A docs-only pull request reaches the public site with no approval.** Such a change already merges by itself when
  CI is green (ADR 0034); it is then copied and published by itself too.
- **A second long-lived write credential sits in this repository's Actions secrets**, after the lexicons key. A
  deploy key has no expiry and no passphrase.
- **Folder ownership is a rule our jobs keep, not one GitHub enforces.** Any source's key can write any file of the
  docs repository, the Pages workflow included. A leaked key, a compromised source repository or GitHub itself
  could therefore change what docs.unset.sh serves, scripts included.
- **What bounds that.** The key opens `unset-sh/docs` and nothing else: not this repository, a server or an account.
  An environment secret is readable only by a job that names the environment, on a ref its branch rule allows, so
  only main reads it. docs.unset.sh shares a registrable domain with the app, so its pages are same-site to
  `unset.sh`: the app's cookies are host-only `__Host-` cookies that a subdomain can neither read nor replace
  (`scripts/guards/cookie-domain.ts`), and every POST must carry the app's own origin, whatever site it comes
  from (`interfaces/web/src/hooks.server.ts`). The next copy restores the right files in a source's folder, and deleting
  a deploy key cuts that source off at once.
- **GitHub hosts the site.** It sees each reader's address, and the response headers are GitHub's: the
  Content-Security-Policy and `noindex` headers the staging edge sets (ADR 0075 Decision 3) cannot be sent. Each
  page says what it can for itself: a robots tag, and the policy in a `meta` tag, which governs only what the
  browser reads after it and cannot hold `frame-ancestors`.
- **A public site with no login leaves the staging edge**, which then serves only the two sites behind Pangolin's
  login, and docs.unset.sh no longer goes down with the staging host.
- **A custom domain on Pages can be taken over** if the DNS record outlives the Pages site, so the domain is
  verified for the organisation, which reserves it and its subdomains for the organisation's repositories
  (github/docs, `content/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages.md`).
- **A broken page in one source can stop the publish for all**: the site build fails on a warning, the run in the
  docs repository goes red, and the last good site stays up. The source's own pull request did not see it.
- **When the organisation becomes the source of truth**, the site moves to the docs repository's root, this
  repository's folder becomes pages like any other, and decision 3 ends. The layout, the history and the keys stay.

## Alternatives

- **The docs repository pulls each source on a schedule**, with its own token and no key. GitHub disables scheduled
  workflows in a public repository after 60 days without activity (ADR 0089, Alternatives), a private source would
  need a credential anyway, and a change would wait for the next run. Alex chose the push.
- **Hugo modules import each source repository directly**, with no gathered repository. Each import is pinned in
  `go.mod`, so every docs change needs a second commit that bumps the pin: the drift this is meant to remove.
- **Keep the staging edge and let the host fetch and rebuild on a timer.** Our headers and no third party, but a
  new job on the host, a delay, and the public site stays on the staging stack. Offered to Alex; he chose Pages.
- **One shared key, or a machine user, for all sources.** One secret to place, but cutting off one source cuts off
  all, and a machine user is an account to keep.
- **A GitHub App with short-lived tokens.** The strongest credential and the most to set up and keep; it can
  replace the keys later without changing anything else (ADR 0089, Alternatives).

## Compliance

`scripts/ci/docs-export.test.ts`: the two folders side by side, tracked files only, a link refused, an empty copy
refused. `scripts/ci/docs-mirror.test.ts`: the trigger, the environment, the single use of the secret, no package
install and no forced push; and the push step, run as written against a throwaway repository: only its own paths
change, a lost race is replayed, and a clash or a refusal fails. `scripts/guards/workflow-pins.test.ts`
(`workflow_rules_hold`) holds the workflow to the guard. `scripts/ci/docs-site.test.ts` holds the Pages workflow,
which this repository's guard cannot reach: CI's own Hugo image and build command, GitHub's pinned actions only,
publish rights in the deploy job alone, and the section step run as written. Acceptance is Alex's line on the pull
request that adds this record.
