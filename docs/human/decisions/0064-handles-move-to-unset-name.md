# 0064 — Handles move from unset.im to unset.name, a DNSSEC-signed domain

Status: Proposed (awaiting Alex). Supersedes the handle rows of accepted ADR 0025 (its Decision tables: production
`<user>.unset.im`, development `<user>.staging.unset.im`). The other three domains of 0025 stand.

## Context
Handles are checked through DNS first: the TXT record `_atproto.<handle>` (https://atproto.com/specs/handle,
"Handle Resolution"). `.im` is not signed at the root ("This delegation is not secured using DNSSEC",
https://www.iana.org/domains/root/db/im.html, read 2026-11-19), so no registrar can publish a DS record for
`unset.im`. Without DNSSEC, someone who can spoof DNS answers to another app's resolver can make that app show their
account under a member's handle. On 2026-11-19 Alex judged that not good enough ("its not really good that do im as no
dnssec", 01:49Z), registered `unset.name` and dropped `unset.im` ("i bough the .name the .im is gone", 01:58Z). `.name`
is signed at the root (https://www.iana.org/domains/root/db/name.html, Verisign, read 2026-11-19).

No member exists yet. On staging two test accounts hold `.staging.unset.im` handles.

## Decision
1. Handles are `<user>.unset.name` in production and `<user>.staging.unset.name` on the development system.
2. `unset.name` is a zone at deSEC with DNSSEC: name servers `ns1.desec.io` and `ns2.desec.org`, DS record (key tag
   62902, algorithm 13, digest type 2) published at Namecheap on 2026-11-19 at Alex's request ("please use namecheap
   and desec to set the handle to the .name", 01:58Z). Namecheap stays the registrar.
3. Preflight C15 pins the development PDS to exactly `.staging.unset.name`, as it pinned `.staging.unset.im`.
4. The two staging accounts move by a handle update on the staging PDS (`com.atproto.identity.updateHandle`), done by
   Alex after the deploy that carries this change. Their records `_atproto.alex.staging` and
   `_atproto.claude-test.staging` are already in the zone.

## Alternatives
- Keep `unset.im` and accept no DNSSEC (our own app is covered by checking our own PDS, ADR 0063 Decision 7). Rejected
  by Alex: other apps would stay exposed.
- Handles under `unset.sh`. Signed, but it ties handles to the app's domain and its records.

## Consequences
- Nothing in the code depends on the handle domain except configuration, preflight C15, test fixtures and docs.
- `unset.name` is registered to 2028-11-19, auto-renew on.
- `.name` names are in the PDS's service handle domains through configuration only; the deploy that changes
  `PDS_SERVICE_HANDLE_DOMAINS` on staging must ship with this PR.

## Compliance
SE-1: improves handle integrity for other apps (DNSSEC). No new personal data, egress or credential.
