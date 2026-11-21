---
status: Proposed
date: "2026-11-21"
step: P6.02
---
# 0105 — staging.unset.cc is published through Pangolin's login, as a fourth site on the staging edge

Record: Proposed 2026-11-21 (P6.02), awaiting Alex's acceptance line. Records Alex's choice of 2026-11-21, "Yes,
behind Pangolin" ("the staging chat is also gonna be behind the same Pangolin login as staging.onset"). Builds on ADRs
0025 (public domains), 0030 and 0032 (Pangolin and Newt in front of the staging edge), 0093 decision 6 and 0099.

## Context
ADR 0025 names `staging.unset.cc` as the staging chat host but gives it only an `_acme-challenge` CNAME and CAA
records, and says it "gains Pangolin's issuer if chat is later routed through Pangolin". ADR 0093 decision 6 says what
the name serves: the chat page and the door's paths to the door, `/_matrix/client/*` to Synapse, nothing to MAS or
chat-admin. The chat servers run on the source stack alone (`deployment/preflight/local-only.ts` `CHAT_SERVICES`),
whose edge is on `chat_edge` (the door's public listener, `10.250.38.43:8090`) and `chat_edge_synapse` (Synapse's
client listener, `10.250.38.51:8008`).

## Decision
1. **The edge's fourth staging site.** `deployment/edge/dev/chat.caddy` serves `staging.unset.cc` on the newt_edge
   address with the dev leaf, like the app site: the security headers, noindex, the too-many-tries page and the
   access log without addresses or paths. Only the source stack's edge mounts it and sets its three values
   (`CHAT_HOST`, `CHAT_UPSTREAM`, `MATRIX_UPSTREAM`), and C18 refuses it on an edge outside the two chat networks.
2. **Two upstream paths, matched before cleaning.** On the decoded path before Caddy cleans it: `/_matrix/client/...`
   with no empty or dot-only segment to Synapse; exactly the door's routes (`/`, `/sign-in`, `/sign-in/return`,
   `/sign-in/redeem`, `/sign-out`, `/sign-out/return`, `/sign-out/redeem`, `/sign-out/done`, `/welcome`,
   `/welcome/done`, `/setup/claim`, `/setup/release`, `/push/key`, `/chat-id`, `/assets/<file>`, `/dm/<did>`) to the
   door; the welcome and sign-out ones arrive with #1939 and #1950. Everything else, `/_synapse/`, federation, keys,
   media outside the client API, `/.well-known/` and the door's `/health` among it, is the edge's own 404. Both
   upstreams get no client address.
3. **Policies.** The door sets its own CSP on every answer (ADR 0099 decision 1); a response with none of its own,
   Synapse's JSON or the edge's 404, gets the strict policy (`?Content-Security-Policy`, set only when absent).
4. **Limits.** `chat_signin` (20 per 5 minutes, GET `/sign-in`, POST `/sign-in/redeem` and POST `/sign-out/redeem`)
   and `chat_global` (6000 per 5 minutes, every request), per client address; the door and Synapse see only the
   edge's address.
5. **Pangolin.** A resource `staging.unset.cc` on the staging site, login on, target `https` to `10.250.37.3:443`,
   certificate check off, TLS Server Name `staging.unset.cc`, as for the other staging names (runbook
   `chat-servers.md`). Public DNS gains the A/AAAA record to Pangolin and, as ADR 0025 foresaw, the
   `CAA 0 issue "letsencrypt.org; validationmethods=http-01"` record for Pangolin's certificate.
6. **The Matrix client API rides the same login.** matrix-js-sdk 43.0.0 sends every homeserver request with
   `credentials: "omit"` (`node_modules/matrix-js-sdk/src/http-api/fetch.ts:312`, "we send credentials via headers"),
   so on its own the browser would not send Pangolin's session cookie on `/_matrix/client/`, and Pangolin would refuse
   those calls while the page and the door's routes (`credentials: "same-origin"`, `apps/chat/core/*.ts`) pass. The
   page therefore hands `createClient` a `fetchFn` (a documented option, `src/client.ts:313`, passed on at `:1358`)
   that sends same-origin credentials, so every call the chat page makes goes through the login. Synapse never
   receives cookies: the edge's Matrix route removes the `Cookie` header before the upstream, so neither Pangolin's
   session nor the door's cookies reach it, and it reads only the bearer token. This is Alex's card answer, the
   option "Yes, behind Pangolin", whose consequence was that the chat page's own calls ride that login (as the
   coordinator relayed it on 2026-11-21; the card's exact consequence line is not quoted here). Pangolin gets no
   bypass rule for the site.

## Alternatives
- **A Pangolin bypass for `/_matrix/client/*`.** Rejected: it would make Synapse's client API public on staging, its
  access token the only gate, where ADR 0025 keeps the login in front of staging as a second layer.
- **No staging chat site** until production: no way to test the chat page in a browser. Declined.
- **The chat site in the image stack too:** that edge is on no chat network, so it would dial the two fixed addresses
  through its outside network. Declined; C18 refuses it.
- **The whole origin to the door, which proxies Synapse:** the door would carry Matrix traffic it has no rule for.
  Declined (ADR 0093 decision 6 routes at the edge).

## Consequences
- A tester signs in to Pangolin once for `staging.unset.cc` as for the app; the hop from `staging.unset.sh` is a
  top-level navigation, so the cookie goes with it.
- **Known limits on staging.**
  - The door's own per-address buckets (`interfaces/chat-auth/compose.ts` POLICIES: `default` 60 at once and 1 a
    second, `sign-in` 10 at once) key on the edge's address, since the door reads the socket
    (`TRUSTED_PROXY_MODE: socket`), so every tester shares them; the edge's `chat_*` zones are the per-client ones.
  - If Pangolin shows its own login on the hop's return, the `#ticket` fragment can be lost on the way back; the page
    then has no ticket and starts the hop again.
- A new door route needs `CHAT_DOOR_PATH` and `dev/chat.caddy` changed with it, or the edge answers 404.
- The image stack (`compose.dev.yaml`) has no chat site until the chat servers have published images.

## Compliance
`deployment/edge/adapted-rules.ts` `chatSiteProblems` and its reds in `adapted-rules.test.ts` (each route, upstream,
header and zone whole; `chat_paths_reach_only_the_ruled_upstream`), `adapted/dev-chat.generated.json`,
`limits.budget.test.ts` "chat zones", `deployment/preflight/preflight.test.ts` `c18_dev_chat_*`,
`compose.dev.source.test.ts` `chat_site_is_on_the_source_stacks_edge_alone`, and the runbook's after-deploy check.
