# 0071 — Limits sized for thousands of members, and web's own PDS calls marked

Status: Accepted by Alex, 2026-11-20 02:51Z, against dbfc459 (his line "Merge 1820 at dbfc459", typed in the project
chat after the coordinator had reviewed that head and CI was green; merged as 6b65247). This status paragraph, the index
row and the ADR 0001 acceptance line were added afterwards in the next P2.17 pull request. Step P1.21j. It loosens
security controls (ADR 0059 decision 1). Alex, 2026-11-20, on upload limits: "make a very generous limit … I don't want
to discover that these are issues once the users are scaling up". The project is not live. It supersedes ADR 0042's two
ceiling values (Decision 2) and ADR 0031 Decision 1's `app_signin` matcher and value. Neither accepted record is edited.

## Context
P1.21h (`deployment/edge/limits.budget.test.ts`, `interfaces/web/src/lib/server/limits.budget.test.ts`) gave every
limit a member's use reaches a test that normal use fits, and found four limits that break first as members arrive:

1. **`app_signin`** (edge, per address, 5 per 5 minutes) counted `POST /login`, the `/oauth/callback` redirect and
   `POST /verify-email`. A first sign-in made three events, so two people behind one address (a household, a phone
   carrier's shared address) signing in for the first time within 5 minutes made six.
2. **Web's site-wide `default` bucket** (ADR 0042: 3000 at once, 50 a second) held about 100 members each clicking
   every 2 seconds and refused at about 200. Its sign-in twin (120 at once, 2 a second) held about 60 sign-ins a minute.
3. **PDS `global`** (edge, per address, 3000 per 5 minutes) and
4. **PDS `oauth_token`** (120 per 5 minutes). Web reaches our PDS by its public name through Pangolin, Newt and the
   edge (ADR 0031 Decision 3), so every member's PDS calls arrive from web's one address. A member's own profile page
   is 3 PDS calls and a card save is 5. That made `global` site-wide in effect: about 29 members each saving a card
   every 15 seconds filled it, and every member's next call failed. Sign-ins and hourly token refreshes shared
   `oauth_token`, so 100 sign-ins in 5 minutes left room for about 240 other active members.

Raising (3) and (4) for everyone cannot fix this. The value thousands of members need from one address (about 1500
calls a second) would also be what one attacker's address may send, and the PDS's per-client flood stop would be gone.
Web's calls have to be told apart from other clients' calls.

## Decision
1. **`app_signin` counts `POST /login` and `POST /join` only, 10 per 5 minutes per address** (was 5, and also the
   callback and `POST /verify-email`). One sign-in or sign-up is one event, so ten fit behind one address in 5
   minutes, and the eleventh login post is refused. The callback can only follow a login the zone already counted: web
   rejects a callback whose state it did not issue. `POST /verify-email` needs a signed-in session. Both still count in
   `app_burst` and `app_global`, and in web's `login` ceiling. This is the line Alex had not yet typed in P1.21h ("Count
   only the login post in the edge sign-in limit"), with `POST /join` kept beside it.
2. **Web's site-wide ceilings** (`interfaces/web/src/lib/server/limits.ts`, socket mode):
   - `default`: 30000 at once, 500 a second (was 3000 and 50). That holds 1000 members each clicking every 2 seconds,
     or about 5000 at a page every 10 seconds, and refuses within a minute at 2000 such clickers.
   - `login`: 600 at once, 10 a second (was 120 and 2). That is about 300 sign-ins a minute, each a `POST /login` and its
     callback.
   - These remain backstops against a flood from many addresses (ADR 0042 Consequences). The edge still limits each
     address. Neither value comes from a load test: one web process may saturate below them, and the P5 load test sets
     the real figures.
3. **Web marks its own calls to our PDS, and the edge gives them their own zones.**
   - **The key.** A new secret, `pds_web_key`, holds 64 lower-case hex characters (`openssl rand -hex 32`). Web
     reads it as `PDS_WEB_KEY_FILE` and refuses to boot if it is not exactly that shape.
   - **What web sends.** Web sends `X-Unset-Web-Key: key-<key>-key` on every request its OAuth client makes, and only
     to our own issuer. The client's fetch already refuses every other origin (P1.36v,
     `infrastructure/pds/oauth/oauth-client.ts` `ownIssuerOnly`), so the key cannot reach another server.
   - **What the edge compares.** The edge (`deployment/edge/snippets/ratelimit.caddy`) treats a request as marked only
     when the header matches `^key-[0-9a-f]+-key$` and equals `key-{file./run/secrets/pds_web_key}-key`. Caddy reads
     the file at request time and trims one trailing newline (Caddy v2.11.9 `replacer.go`
     `fileReplacementProvider`). The comparison is exact (`matchers.go` `matchHeaders`). Only a value that starts or
     ends with `*` would be a wildcard, and the fixed ends rule that out.
   - **The zones.** A marked request skips `global` and `oauth_token` and counts instead in `web_global` (90000 a
     minute) and `web_oauth_token` (3000 per 5 minutes). Both are keyed `web`, one bucket for all of web, whatever
     address it arrives from.
   - **The header goes no further.** The edge deletes it before the PDS (`upstream.caddy`, `header_up`), and never
     logs it (`log.caddy` deletes request headers).
4. **The marked zones are sized from web's own ceilings.** Pages at 500 a second, with up to 3 PDS calls each, make
   1500 calls a second: 90000 a minute. Sign-ins at 10 a second make 5 token exchanges a second, plus about one refresh
   an hour per active member: 3000 per 5 minutes is 10 a second. That holds about 4000 members each saving a card every
   15 seconds, or 1000 sign-ins in 5 minutes while 20000 members stay active. A web that is broken, or in an attacker's
   hands, still meets these numbers.
5. **What is not covered.** `blob_upload` is left alone: ADR 0070 owns uploads. A marked zone for web's uploads would
   take the same shape, next to these. The other PDS zones (`sync`, `identity`, `session` and the sign-in pages) are
   unchanged and still apply to web's address.

## Failure modes
- **The edge's file is missing or unreadable.** Caddy logs the file name, never its content, and reads it as empty.
  The expected value is then `key--key`, which the hex pattern can never be, so every call stays in today's tight
  zones. The fault is closed, and visible as 429s under load.
- **Web's key is missing or the wrong shape.** Web does not boot (config rule).
- **Web's and the edge's keys differ.** Web's calls are unmarked and stay in the tight zones. This also fails closed.
- **A client sends a guessed, bare or malformed value.** It is unmarked and stays in that address's `global` and
  `oauth_token`. The image test `edge_spoofed_web_key_stays_in_global` sends a wrong key, the bare key, `key--key`,
  `*` and a value with extra characters.
- **The key leaks.** Whoever holds it shares web's one bucket (`key web`), not a bucket per address. They can crowd
  out web's own calls, up to web's ceiling, until the key is replaced: a new file for both services and a restart of
  each.

## Alternatives
- **B. The edge recognises web by its address**, set in config. There is no secret, but on staging that address is
  the home's public IP. When it changes, web silently drops back to the tight zones. Rejected for that.
- **C. Web reaches the PDS inside the stack**, as the indexer and pds-admin do. This contradicts accepted ADR 0031
  Decision 3, would join web to the PDS network, and would bypass the edge's xrpc guard for web's calls. Rejected:
  it moves a network boundary for a rate limit.
- **Just raise `global` and `oauth_token`** to thousands-of-members values for every address. Rejected: a single
  attacker address could then send about 1500 calls a second to the PDS.
- **Key web's calls by their `Authorization` header.** Rejected: anyone can send a fresh made-up value per request
  and get a fresh bucket.
- **Leave the four limits.** Rejected: each is the first thing to break as members arrive (P1.21h's findings).

## Consequences
- Before the deploy, the server needs `pds_web_key`: Alex makes it by hand (runbook `dev-stack-secrets.md`), mode 0400,
  owner 65532, read by the edge and web. Preflight C9 refuses to deploy while it is missing.
- The P1.21h `test.fails` cases become passing budgets at the new values, and each new value has a flood test.
- An outside client's per-address PDS limits are unchanged.

## Compliance
- `deployment/edge/limits.budget.test.ts` and `interfaces/web/src/lib/server/limits.budget.test.ts` hold the sizes and
  the floods.
- `deployment/edge/edge.test.ts` `edge_web_key_zones_are_exact` holds the matcher shape in every adapted config.
- `tests/integration/deployment/edge/edge.image.test.ts` holds the real edge's behaviour:
  `edge_spoofed_web_key_stays_in_global` and `edge_web_key_leaves_global_for_web_global`.
- `infrastructure/pds/oauth/sign-in.test.ts`
  `every_request_to_our_pds_carries_web_s_key_between_its_fixed_ends` holds what web sends.
