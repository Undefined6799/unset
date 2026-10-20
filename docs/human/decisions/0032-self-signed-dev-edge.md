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
through one `(tls)` snippet mounted over `snippets/tls.caddy` (`deployment/edge/local/tls.caddy:1-8`); dev takes
the same shape with a self-signed leaf instead of the dev root's.

## Decision
This record supersedes ADR 0031 Decision 2 ("Edge without a certificate under dev", 0031:119-139) for the dev
profile only. Everything else in 0031 stands: both names public with no login (Decision 1), web through Pangolin
and the client-address keys (Decision 3), the PDS denylist (Decision 4), federation and handles (5, 6), and the
0025 and 0030 clauses it departs from. Production is unchanged: `unset.ac` keeps Let's Encrypt at the edge under
ADR 0028 and the Phase 5 records.

1. **The certificate.** Under dev each edge site serves one self-signed leaf certificate for both staging names
   (`staging.unset.sh`, `staging.unset.ac` as SANs), from PEM files, through a dev `(tls)` snippet
   `deployment/edge/dev/tls.caddy` of exactly the local shape, `tls <cert_file> <key_file>`
   (`local/tls.caddy:7-8`), mounted read-only over `snippets/tls.caddy` by the dev compose file only. No
   issuer, no ACME account, no DNS token, no CA: nobody is asked to trust the certificate, and nothing installs
   it anywhere. The key is a C9 file secret mounted only into the edge, with a test that no other service mounts
   it; the certificate is public by nature. Validity is at most 825 days; the runbook generates the pair on the
   staging host with one command (OpenSSL from the host's packages, parameters fixed in the runbook: P-256, the
   two SANs, no CA flag) and regenerates it the same way; the deploy check fails 30 days before expiry.
2. **What it buys, and does not.** The bytes between Newt and the edge, two containers on the same host on the
   internal `newt_edge` network (0030 Decision 2), are encrypted. Nothing verifies the certificate: Pangolin's
   targets to Newt become `https` and Pangolin does not verify the upstream certificate (0030:71-74), so this is
   encryption without authentication on a host-local hop, chosen by Alex as cheap defence in depth, not as a
   trust boundary. The app and the PDS never derive their scheme from the request (0031 Decision 2's rule
   survives): cookies stay `Secure`, the OAuth issuer, the client metadata URLs and every public URL stay `https`
   from configuration; both sites keep the security headers.
3. **C18 under dev** (P1.38e, a loosening of C18's rule that the served `(tls)` must read the same as
   `snippets/tls.caddy`, so it needs Alex's own typed line, separate from this record's): under `--env dev` the
   served `(tls)` must read the same as `dev/tls.caddy`, which must be exactly `tls <cert_file> <key_file>` with
   both paths under the dev mount; any `tls internal`, any acme issuer, any `local_certs`, `pki` or `auto_https`
   global, any site without `import tls`, any `:80` site in the configuration, and any published port under dev
   fail. Under prod C18 is
   unchanged and keeps refusing anything but Let's Encrypt; a self-signed or file certificate under prod fails.
   Local is unchanged (its own `(tls)`, P1.33t). Reds for each refusal and for the prod and local branches.
4. **Edge shape otherwise as 0031 Decision 2:** bound only to the edge's address on `newt_edge`, no published
   port, no `:80` site in the configuration (replacing 0031's "no `:443` site"). Caddy still opens `:80` on that
   address at run time for its automatic redirect to `https` (Caddy v2.11.7 `caddyhttp/autohttps.go:198-212`
   skips only certificate management for a file certificate, and `:229-268` records a redirect for every
   listener unless `disable_redirects` is set, a global this record keeps outside the reader's allowlist), so
   `:80` answers only a `308` to `https://` with no body and no upstream, and the deploy check asserts exactly
   that. The `_acme-challenge` CNAMEs are not created for staging and the CAA records drop the edge's `dns-01`
   line, as 0031 already says; P1.36e, P1.36o and the DNS provider steps stay production work; the deploy check
   that P1.37v brings connects from `newt_edge` and asserts `https` with this certificate on the bound address,
   the `308`-only `:80`, and reads the expiry.
5. **Pangolin.** Both resources target the edge over `https`; no Pangolin setting is changed to make it verify
   the certificate, since it cannot be verified by anyone and 0030 already accepts the unverified last hop.

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
- A certificate that expires takes staging down until the runbook command runs; the deploy check's 30-day
  warning is the only guard. Accepted as a staging cost.

## Compliance
- Reds listed in Decision 3 and 4 land with P1.38e, P1.36b, P1.36c and P1.37v before the first deploy.
- The private key never enters the repo, CI, logs or a message; the runbook command writes it with mode 0600
  under the C9 owner, and the preflight secret predicate refuses a literal key anywhere else.
- No trust store, CA or root is created or installed by this record, on the host, in a container or on a tester's
  device; a check asserts the certificate is a leaf (no CA flag) and that no service names `NODE_EXTRA_CA_CERTS`
  (0031 Decision 3's red).
- Acceptance line: "yes accept ADR 0032 self-signed certificate at the dev edge behind Pangolin
  docs/human/decisions/0032-self-signed-dev-edge.md".
