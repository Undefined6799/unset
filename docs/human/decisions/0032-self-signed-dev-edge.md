# 0032 — Self-signed certificate at the dev edge behind Pangolin

Status: Proposed (awaiting Alex)

## Context
Accepted ADR 0031 (2026-10-20 21:04:02Z), Decision 2, has the dev edge's two sites listen on plain `http` behind
Pangolin, with no certificate at our edge; preflight C18 still refuses that shape on main
(`deployment/preflight/checks/edge.ts:400-401` runs it under `--env dev`, and `certificateProblems` at :152-153
fails every site that does not import `tls`, :223), so the plain-`http` edge waited on a C18 change with its own
typed line (P1.38e). On 2026-10-20, asked for that line, Alex chose otherwise: "it will have tls from lets
encrypt / from pangolin" (21:39:10Z, 21:39:22Z), "can you not just generate a certificate on the server??"
(21:40:01Z), "but only pangolin is the edge right? feels like a self-signed certificate could be a good
application there" (21:41:50Z), and "self-signed and make 1 big PR for the last push" (21:42:50Z). The internet
still sees only Pangolin's Let's Encrypt certificate; this record is about the hop behind it, Newt to our edge,
which 0030 Decision 2 (0030:71-74) describes as host-local and unverified by Pangolin.

An accepted record is never edited, so this record supersedes exactly one decision of 0031 and leaves the rest
in force. Caddy's own internal CA stays closed: C18's certificate rule exists to refuse it (edge.ts:200-206,
refocus Amendment 1 of 2026-10-12), and the global options that would turn it on (`local_certs`, `pki`,
`auto_https`) stay outside the reader's allowlist. The local stack already serves a leaf certificate from a file
through one `(tls)` snippet mounted over `snippets/tls.caddy` (`deployment/edge/local/tls.caddy:8-10`); dev takes
the same shape with a self-signed leaf instead of the dev root's.

## Decision
This record supersedes ADR 0031 Decision 2 ("Edge without a certificate under dev", 0031:119-137) for the dev
profile only. Everything else in 0031 stands: both names public with no login (Decision 1), web through Pangolin
and the client-address keys (Decision 3), the PDS denylist (Decision 4), federation and handles (5, 6), and the
0025 and 0030 clauses it departs from. Production is unchanged: `unset.ac` keeps Let's Encrypt at the edge under
ADR 0028 and the Phase 5 records.

1. **The certificate.** Under dev each edge site serves one self-signed leaf certificate for both staging names
   (`staging.unset.sh`, `staging.unset.ac` as SANs), from PEM files, through a dev `(tls)` snippet
   `deployment/edge/dev/tls.caddy` of exactly the local shape (`local/tls.caddy:7-9`), reading
   `tls /run/secrets/dev_tls_cert /run/secrets/dev_tls_key`; the snippet is mounted read-only over
   `snippets/tls.caddy` by the dev compose file only, and both files are C9 file secrets under `/run/secrets/`,
   mounted only into the edge, with a test that no other service mounts them (the key is secret; the certificate
   is public by nature but travels the same way, so nothing certificate-shaped sits in the checkout). No issuer,
   no ACME account, no DNS token, no CA: nobody is asked to trust the certificate, and nothing installs it
   anywhere. Validity is at most 825 days; the runbook generates the pair on the
   staging host with one command (OpenSSL from the host's packages, parameters fixed in the runbook: P-256, the
   two SANs, no CA flag) and regenerates it the same way; the deploy check fails 30 days before expiry (the
   failure is the only guard; nothing renews on its own). P1.37v's deploy check also asserts the leaf's key type
   (P-256) and that its validity is at most 825 days; the runbook's parameters are otherwise unchecked.
2. **What it buys, and does not.** The bytes between Newt and the edge, two containers on the same host on the
   internal `newt_edge` network (0030 Decision 2), are encrypted. Nothing verifies the certificate: Pangolin's
   targets to Newt become `https` and Pangolin does not verify the upstream certificate (0030:71-74), so this is
   encryption without authentication on a host-local hop, chosen by Alex as cheap defence in depth, not as a
   trust boundary. The app and the PDS never derive their scheme from the request (0031 Decision 2's rule
   survives): cookies stay `Secure`, the OAuth issuer, the client metadata URLs and every public URL stay `https`
   from configuration; both sites keep the security headers.
3. **C18 under dev** (P1.38e, a loosening of C18's rule that the served `(tls)` must read the same as
   `snippets/tls.caddy`, so it needs Alex's own typed line, separate from this record's): under `--env dev` the
   served `(tls)` must read the same as `dev/tls.caddy` (in the dev mount), which must be exactly
   `tls /run/secrets/dev_tls_cert /run/secrets/dev_tls_key`; any `tls internal`, any acme issuer, any
   `local_certs`, `pki` or `auto_https` global, any site without `import tls`, any `:80` site in the
   configuration, any certificate path outside `/run/secrets/`, and any published port under dev fail. Under prod C18 is
   unchanged and keeps refusing anything but Let's Encrypt; a self-signed or file certificate under prod fails.
   Local is unchanged (its own `(tls)`, P1.33t). Reds for each refusal and for the prod and local branches.
   The same rule under dev also allows exactly two more edge mounts, the snippet at `/etc/caddy/snippets/tls.caddy`
   and the `dev/` directory, both read-only from inside `deployment/edge/`; today C18 refuses any edge mount over
   `/etc/caddy` but the sites directory (`edge.ts:78-81`), so P1.38e merges before P1.36c, whose mounts would
   otherwise fail it. `--env dev` fails on main today and keeps failing after both: C2 refuses the four services
   `compose.dev.yaml` builds until P2.26b pins them from the lock (`images.ts:38`), C3 and C4 need P2.26e's trusted
   root, C18 refuses an edge not run from the lock's image (`edge.ts:132-137`) until P2.26b, and C21 needs P1.33a's
   retirement report (`host.ts:18-40`). The first green `--env dev` on main is after P1.36b, P1.38e, P1.36c, P1.37v,
   P1.27s, P2.26e and P2.26b have merged and P1.33a's report is committed.
4. **Edge shape otherwise as 0031 Decision 2:** bound only to the edge's address on `newt_edge`, no published
   port, no `:80` site in the configuration (replacing 0031's "no `:443` site"). Caddy still opens `:80` on that
   address at run time for its automatic redirect to `https` (Caddy v2.11.7 `caddyhttp/autohttps.go:198-212`
   skips only certificate management for a file certificate, and `:229-268` records a redirect for every
   listener unless the `auto_https disable_redirects` option is set, which this record keeps outside the reader's
   allowlist), so
   `:80` answers only a `308` to `https://` with no body and no upstream, and the deploy check asserts exactly
   that. The `_acme-challenge` CNAMEs are not created for staging and the CAA records drop the edge's `dns-01`
   line, as 0031 already says; P1.36e, P1.36o and the DNS provider steps stay production work; the deploy check
   that P1.37v brings connects from `newt_edge` and asserts `https` with this certificate on the bound address,
   the `308`-only `:80`, and reads the expiry.
5. **Pangolin.** Both resources target the edge over `https`, and each resource's TLS Server Name is set to its
   own staging name. Pangolin 1.24.0 addresses Newt's target by IP literal (`server/lib/loadBalancer.ts:53-57`),
   so Traefik sends no SNI unless `tlsServerName` is set (`server/lib/traefik/getTraefikConfig.ts:467-481`), and
   Caddy serving only file certificates with no `default_sni` fails a handshake that carries no SNI (certmagic
   `handshake.go:118-175`); this is from reading the source, not from running it, so the deploy check also makes
   one request through Pangolin to each name. That setting joins Alex's Pangolin steps in the runbook. No Pangolin
   setting is changed to make it verify the certificate, since it cannot be verified by anyone and 0030 already
   accepts the unverified last hop.

## Alternatives
- **Plain `http` behind Pangolin** (0031 Decision 2). Simplest, and what 0031 chose. Not chosen by Alex on
  2026-10-20 at 21:42:50Z, after hearing it needs the same C18 line and that the self-signed option protects
  only a host-local hop.
- **Caddy's internal CA (`tls internal`).** Forbidden by refocus Amendment 1 and closed by C18; it would install a
  CA and trust store in the edge container and open the issuer globals. Not reopened.
- **The local dev root (P1.35p)** for the staging names. Name-constrained to `.localhost` (0025:144), so it cannot
  issue them; and a root installed anywhere is a larger trust grant than a certificate nobody trusts.
- **Let's Encrypt by DNS-01 at our edge** (0025:65-71, ADR 0028). The production path; four steps and a DNS
  token on the host, set aside for staging by Alex on 2026-10-19 (23:19:26Z) and again on 2026-10-20 (21:40Z).

## Consequences
- P1.38e is reshaped from "C18 accepts plain `http`" to "C18 accepts the dev file certificate", with the line
  "yes P1.38e deployment/preflight/checks/edge.ts C18 dev self-signed file certificate at our edge"; it merges
  only after this record is accepted. P1.36b renders both dev sites with `import tls` against `dev/tls.caddy`
  instead of without TLS; P1.36c mounts the snippet, the certificate and the key (C9); P1.37v's deploy check
  asserts `https` and the expiry; the runbook gains the generation command and the renewal date. The step book
  changes in the same book edit as ADR 0031's (`unset-plan/book-edits/2026-10-20-adr-0031-no-login.md`).
- ADR 0031 is not edited, not even its status line: the docs immutability test allows an accepted record only the
  whole-record "Status: Superseded by NNNN." change (`scripts/docs/docs.test.ts:107-110`), and 0031 stands in
  every other decision. The partial supersession is recorded here, in 0031's README row ("Decision 2 superseded
  by 0032", the shape 0008 and 0017 use) and in the appended ADR 0001 entry, all at this record's acceptance.
- A certificate that expires takes staging down until the runbook command runs; the deploy check's failure 30
  days before expiry is the only guard. Accepted as a staging cost.

## Compliance
- Reds listed in Decision 3 and 4 land with P1.38e, P1.36b, P1.36c and P1.37v before the first deploy.
- The private key never enters the repo, CI, logs or a message (SE-7); the runbook command writes both files as C9
  mounted file secrets: mode 0400, owned by the edge's uid (65532), inside a 0700 folder owned by the deploy user
  (`deployment/preflight/checks/secrets.ts:4-8`, :266, :276-279), which C9 checks. Nothing in preflight reads a PEM
  body; a PEM committed by mistake is caught only by gitleaks in CI, and the C9 path rule keeps the files out of
  the checkout in the first place.
- No trust store, CA or root is created or installed by this record, on the host, in a container or on a tester's
  device; P1.37v's deploy check asserts the certificate is a leaf (no CA flag) with both staging names as SANs,
  and P1.37v's red asserts that no service names `NODE_EXTRA_CA_CERTS` (0031 Decision 3).
- Acceptance line: "yes accept ADR 0032 self-signed certificate at the dev edge behind Pangolin
  docs/human/decisions/0032-self-signed-dev-edge.md".
