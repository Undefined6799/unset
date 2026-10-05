# Domains: registrar checklist (P0.11, Alex)

This is the checklist for step P0.11 in `docs/ai/book/phase-0.md` (prepared in P0.11a). When you're done, tell the agent which registrar holds each domain and the date you submitted each DS record. The agent then writes `docs/human/domains.md` and runs the dig and RDAP checks.

Whether each domain is free is **not checked**: this session's network blocks RDAP and WHOIS. Check each one at your registrar.

## 1. Pick a registrar for `unset.ac`
It must support DNSSEC DS submission for `.ac` and hardware-key (WebAuthn) 2FA. Cloudflare Registrar does not sell `.ac`. If no registrar qualifies, stop and tell the agent, and the agent will research two candidates.

## 2. Register
- `unset.ac` (production PDS).
- The media domain. It must be its own registrable domain, never a subdomain of the app or the PDS. Candidates:
  - `unsetcdn.net` (the plan's example)
  - `unsetmedia.net`
  - `unset-cdn.net`
- Look-alikes. Pick any you want; the rest can be left.
  - `unset.app`, `unset.dev`, `unset.io`, `unset.com`, `unset.net`, `unset.org`
  - `unsetsh.com`, `unset-sh.com`
  - `unnset.sh`, `unsett.sh`, `unet.sh`
  - `0x40.app`, if the prototype does not already hold it
  - `unset.ca` (Ontario)

For each: auto-renew on, registrar lock on, WHOIS privacy on.

## 3. Turn on DNSSEC
1. Turn on DNSSEC at the DNS host.
2. Submit the DS record at the registrar.
3. Wait until `dig +dnssec @1.1.1.1 <domain> SOA` shows the `ad` flag.

If resolution breaks, remove the DS at the registrar first, then fix the problem.

## 4. Set the records
**Parked domains:** `unset.ac`, the media domain, and every look-alike. Each gets:
- CAA `0 issue ";"`, `0 issuewild ";"` and `0 iodef "mailto:security@unset.sh"`
- MX `0 .`
- TXT `v=spf1 -all`
- `_dmarc` TXT `v=DMARC1; p=reject;`
- no A or AAAA record

**`unset.sh`:** keep its mail records for `security@unset.sh` as they are. Add the parked CAA lines above; it keeps them until P1.28.

**`0x40.*` domains:** leave them for now. The agent adds CAA only after checking which CA currently issues their certificates.

Never publish anything under `int.unset.sh`.

## 5. Tell the agent
- each domain's registrar and DNS host
- each DS submission date
- who has access to each account

## 6. Reserved labels
Accept or strike the proposed labels in the reserved-labels PR. The minimum set from plan §5.2 stays either way.
