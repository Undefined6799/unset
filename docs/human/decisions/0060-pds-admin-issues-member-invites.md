# 0060 — `pds-admin`, the one holder of the PDS admin password, issues member invites

Status: Proposed (awaiting Alex). Step P2.09 (with P2.09k). Alex, 2026-11-18 13:09Z, on running it on staging:
"staging should ... be the exact same as the production environment ... the PDS admin and staging should also be
there."

## Context
Members are to invite people from the plus (Create) menu. Our PDS is invite-only (`PDS_INVITE_REQUIRED=true`,
preflight C7), and today only Alex makes codes, by hand, with the admin password on the staging host.

A member's own session cannot get codes. In the pinned PDS (image `ghcr.io/bluesky-social/pds` v0.4.5051, which is
`@atproto/pds` 0.5.51), `com.atproto.server.getAccountInviteCodes` refuses every OAuth session: its `authorize` throws
"OAuth credentials are not supported for this endpoint"
(`packages/pds/src/api/com/atproto/server/getAccountInviteCodes.ts`, line 19, at tag `@atproto/pds@0.5.51`). Our app
signs in only with OAuth, so no scope we could ask for helps. The only other way is
`com.atproto.server.createInviteCode`, which takes the admin password (`createInviteCode.ts`, `adminToken`) and which
our edge already refuses on the public name (ADR 0031, item 4).

ADR 0001 (step-book gaps, 2026-10-02 22:25Z) moved an "`invite.issue`-only `pds-admin` stub" to Phase 2, and its third
batch (22:54Z) gave `pds-admin` egress to the PDS only. ADR 0001 is still proposed, so no accepted record decides the
service. This one does.

## Decision
1. **A new process, `interfaces/pds-admin`, is the only holder of the PDS admin password.** It reads the password once
   at boot from a secret file and uses it only to build the `Authorization` header for calls to the PDS's internal
   URL, which must resolve to private addresses. It sits on the internal network only, in every environment
   (staging is built like production; staging's PDS is a separate PDS from production's).
2. **It accepts one verb, `invite.issue`, and nothing else.** One route, `POST /v1/invite.issue`, plus `GET /health`;
   everything else is 404. There is no passthrough to the PDS, and no password, e-mail or takedown route. The one
   other use of its PDS client is the operator command `cli.ts check-reserved`, run by hand on the host: it calls
   the public `com.atproto.identity.resolveHandle` for each reserved label, without the admin password, through the
   same single egress file.
3. **Every request is an Ed25519-signed envelope from `web`'s key**, single use and short lived: pinned key id, verb,
   audience, environment and PDS DID; `exp - iat` at most 60 s; a `jti` written to disk and fsynced before the PDS
   call, so a replay fails across restarts and races. A member may issue only for themselves (`actor_did == target`).
   The key file names one key with one verb; P3.16's signed roster replaces it. Rotation until then: generate a new
   key pair, put the new public key in pds-admin's key file and the private key in web's secret, and restart both.
   Requests signed in between fail as `unavailable` and web retries with a fresh envelope; nothing else carries over.
   Each environment has its own web key, and staging never shares production's.
4. **Limits sit in the service, not in `web`.** At most `INVITE_MAX_PER_WINDOW` (5) codes per account per
   `INVITE_WINDOW_HOURS` (24), counted from the PDS's own list of the account's codes, and `INVITE_MAX_PER_DAY_GLOBAL`
   (100) per UTC day, counted from the service's log (Alex, 2026-10-03, P2-A2). The daily slot is written to the log
   and fsynced before the PDS is asked for a code, so a crash after the PDS created one cannot leave it uncounted.
   `SIGNUPS_OPEN=false` refuses all.
   Only accounts hosted on our PDS, with a confirmed e-mail, not deactivated, not taken down and not invite-disabled,
   get a code. So a compromised `web` can mint at most those numbers and can do nothing else.
5. **The service writes a hash-chained log** with one line per request outcome. It never holds a code, a raw DID or
   the password: DIDs and codes are HMACs under a log key, so an investigation can still link lines, and `eraseDid`
   has nothing to reach. Growth is bounded by who can reach the service: only web, on the internal network, under its
   own per-member limit (10 an hour, P2.10). A line is about 400 bytes and an issued invite writes two, so the
   100-a-day cap adds about 80 KB a day; refusals are the rest. The file is not trimmed in Phase 2. The nightly
   verifier (P3.22) checks the chain and archives a verified prefix past 64 MiB, carrying the last hash forward as
   the next file's first `prev`; until it lands, the runbook checks the file's size weekly.
6. **No third-party package**, in the service or in what it imports (`shared/admin-envelope`, the one allowlisted
   folder; ADR 0057 point 5). It is TypeScript that Node 26 runs directly (type stripping), so it is type-checked and
   linted like the rest; the step book's `.mjs` names become `.ts`. Its only outbound calls are in one file,
   `interfaces/pds-admin/pds.ts`, the egress guard's single exemption.
7. **`web` reaches it through net-guard's `pds-admin` policy** (P2.09k): one exact internal origin, private answers only.

## Alternatives
- **The member's own session calls `getAccountInviteCodes`.** Refused by the pinned PDS for OAuth (Context). An app
  password would bypass OAuth and hand `web` a full-access credential per member: rejected.
- **The admin password in `web`.** One process fewer, but the public-facing process would hold a credential that can
  take down, reset or delete any account. Rejected: the separate process is the point.
- **Alex keeps making codes by hand.** No new service, but members cannot invite and he carries every request. Kept
  only as the fallback while this is not deployed.
- **Ozone or another admin tool.** Far larger than one verb, and it holds the same password. Rejected for now.

## Consequences
- A new container, secret files (admin password, envelope public key, log key) and a `web` signing key: P2.09d adds
  them to the stacks; the staging deploy is Alex's.
- Revoking or expiring a code needs a second verb (`com.atproto.admin.disableInviteCodes`). It is left for P3.16 and
  the admin screens (P3.20a); until then codes are one use and do not expire.
- A crash between the PDS call and the log append leaves a code without a log line; the nightly verifier (P3.22) is
  the detector. Accepted for Phase 2.
- The service exits on purpose when a state file's contents can no longer be known: an append failed and cutting it
  back failed too (as PostgreSQL stops on a failed fsync). A restart rereads the files as they are, so it must run
  under a restart policy; P2.09d gives its compose service one, and the runbook says a crash loop is the alert.
- The PDS itself keeps which account owns each code and which account used it; the app adds only the inviter's own
  list (P2.10). Invite-chain takedown (P5.08e) reads the PDS.

## Compliance
- The P2.09 tests in `tests/integration/pds-admin/`: envelope rejections, replay across restart and in parallel,
  quotas under concurrency, routes, body cap, log chain, no raw DID or code in the log, missing secret.
- dependency-cruiser's `admin-service` and `shared-admin-envelope` rows and `scripts/workspace/references.ts`: no
  third-party package in the service or its closure.
- The egress guard's exemption names exactly `interfaces/pds-admin/pds.ts`.
- The edge keeps refusing `createInviteCode` and the admin surface on the public PDS name (ADR 0031).
