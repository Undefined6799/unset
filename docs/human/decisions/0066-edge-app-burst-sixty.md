# 0066 — The edge's app_burst zone allows 60 requests per 10 seconds

Status: Accepted by Alex, 2026-11-20 00:33:12Z, against b62aa80 (his line "Merge 1808 at b62aa80", typed in the project
chat after the coordinator had reviewed that head and CI was green). The only changes since that head are this status
paragraph, the index row, the ADR 0001 acceptance line, merges of main and the record of ADR 0067's acceptance. Step
P1.20r. Alex asked for it on 2026-11-19 13:17:24Z: "increase it from 20 to 60". It loosens a security control (ADR 0059
decision 1). It supersedes the value 20 for `app_burst` and its reason in ADR 0031 Decision 1, and two statements of ADR
0042 (below). Neither accepted record is edited.

## Context
ADR 0031 Decision 1 gave the dev app site's edge a per-client zone `app_burst`, no matcher, 20 events per 10 seconds,
"which holds one client at 2 a second, under the 5 a second at which web refills its shared `default` bucket ... so
no single client can keep `default` empty". ADR 0042 later made web's buckets site-wide behind the edge: `default` is
3000 at once refilled at 50 a second, and the edge is the only per-client limiter. The reason for 20 (one client under
a per-address refill of 5 a second) has been gone since then; the value stayed.

On 2026-11-19 Alex pressed Settings and Profile quickly on staging and got a white page (P1.20o, #1757). A warm
client navigation in the SvelteKit app costs one request (its `__data.json`) and a cold page five, so about two
clicks a second passes 20 in ten seconds. A refused navigation makes SvelteKit fetch again and then load the full
page, which is refused too. With no limit, the same clicking gave no errors.

## Decision
1. `app_burst` allows 60 events per 10 seconds per client address, with the same key (`{client_ip}`, IPv6 /64),
   window and lack of matcher. `app_signin` (5 per 5 minutes), `app_global` (1200 per 5 minutes) and every PDS zone
   are unchanged. The value lives in `deployment/edge/limits.json` and `snippets/ratelimit.caddy`.
2. `app_burst` is now a burst cap only. At 60 per 10 seconds it would allow 1800 per 5 minutes, so `app_global`
   bounds a client's sustained average at 4 a second.
3. Superseded: in ADR 0031 Decision 1, the value 20 and its reason (2 a second under web's per-address refill); in
   ADR 0042 Decision 1, "unchanged" as it applies to `app_burst`; in ADR 0042 Decision 2 and its Consequences, the
   sizing of `default` as "25 clients at the edge's full sustained allowance" and "25 can exhaust `default`".

## Alternatives
- **Keep 20.** Rejected: ordinary fast clicking meets it, and the member sees a white page or "Too many tries".
- **A separate zone for `__data.json`.** Not safer: zones add up, so a client gets the old 20 plus the new zone,
  and a client chooses which path it requests. If anything is split off later, it is the hashed immutable files
  (#1753), which a browser caches.
- **A smaller raise, such as 40.** Covers two clicks a second after a cold page but not a fast burst; Alex chose 60.

## Consequences
- A member can load a cold page and then click four times a second for ten seconds without a refusal; a client
  sending 61 at once is still refused the 61st.
- Sustained drain of web's site-wide `default` bucket (refill 50 a second): about 13 addresses at `app_global`'s
  4 a second keep it empty, where about 25 at the old 2 a second did.
- Instant drain: 50 addresses each sending their 60 at once empty the 3000 `default` bucket, where it took 150
  at 20. Every member then gets 429 until it refills, about 60 seconds at 50 a second. For a staging site behind
  Pangolin this is accepted.
- ADR 0042's site-wide `default` bucket is the real exposure under any `app_burst` value. It should be revisited
  before production (P5), with the production edge's limits.

## Compliance
`deployment/edge/edge.test.ts`: `app_burst_lets_a_member_click_four_times_a_second_and_refuses_a_flood` models
caddy-ratelimit 5625512f24f6's ring buffer (`ringbuffer.go:66-84`) and fails at 20; `edge_ratelimit_matches_limits`
pins the adapted zones to `limits.json`. CI's images job checks the adapted JSON against `caddy adapt`.
