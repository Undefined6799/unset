# 0045 — The request kit enforces the session gate on routes that require one

Status: Accepted by Alex, 2026-11-15 23:26:34Z, against 7f29dc1. The coordinator's project-chat post asked for the
line "accept ADR 0045 at 7f29dc1", on the head it had verified; Alex replied to that post with "ccept ADR 0045 at
7f29dc1" (a paste dropped the first letter). He had chosen the direction on 2026-11-15 23:18:33Z (decision card
"Choose how routes enforce sign-in before Phase 3", option "Kit enforces it"). From here the record changes only to
be marked superseded.

## Context
Every route states whether it needs a signed-in session (`session` on `defineRoute`, architecture ruling
2026-10-05). The kit had an enforced value, `"required"`, that could not be used: no server passed it a session
reader, a request without a session got a 500 instead of the way to sign in, and the handler was never given the
session the kit had read. So every signed-in web route declared `"handler"` and checked the session itself, and the
manifest recorded an intention no machine checked. A route whose handler forgot the check would have run signed out.

The same gap blocked per-member rate limits. A policy with a per-DID entry is allowed only on a `"required"` route,
so the `search`, `report`, `follow`, `like` and `upload` policies could not be attached to anything, and
`POST /profile` wrote to the member's PDS under the site-wide ceiling alone.

Found by the whole-project review of 2026-11-15 (security finding 4, architecture F6), which asked for it before
Phase 3 adds follows, likes and reports.

## Decision
1. `session: "required"` is enforced by the kit. The serving interface passes `createServer` one `gate`. For each
   request to such a route the kit calls it after the CSRF gate and inside the route's deadline.
2. The gate answers with an admission (the DID and the interface's own session value) or with the response that
   refuses the request. The interface decides what refusal looks like; for a page it is the redirect to sign in.
   The kit sends that response and the handler does not run.
3. An admitted request is then limited per DID when its policy has such an entry, and its handler receives the
   session in the route context. A `"required"` handler is typed to take that session; a `"handler"` or `"none"`
   route's handler is given none.
4. Fail closed in four places. A server with a `"required"` route and no gate refuses to start. A gate that
   throws, or admits without naming a DID, is an error response, never an admission. The stored handler of a `"required"` route throws when it is
   called on a context that carries no session.
5. `"handler"` stays, for a route that must also answer a visitor the gate would refuse: the onboarding and
   email-confirmation pages, which run before a member is complete, and a page that shows different things to a
   signed-in and a signed-out visitor. It is the exception a reviewer asks about, no longer the normal case.
6. What "signed in" means is the interface's: the web server's gate is the app gate (session, then onboarding, then
   a confirmed email). The kit knows no product rule.

## Alternatives
- **Keep the check in handlers, remove `"required"`, give handlers a `limitDid(did)` call, and add a test that
  every such handler calls the gate.** Half the work. Not chosen: the protection stays a convention with a test
  behind it, and a new route fails open until that test notices.
- **A table of named gates** (signed in; full member), chosen per route like a rate-limit policy. Not chosen yet:
  today only one level would have users, and a second can be added when a route needs it.
- **Leave it.** Rejected: Phase 3's routes need per-member limits.

## Consequences
- A new signed-in route cannot forget the check: without `"required"` it has no session to use.
- The session is read once per request, by the gate, and the handler uses that value.
- Moving a route from `"handler"` to `"required"` changes its manifest entry (`requiresSession`), which
  `scripts/docs/endpoints.ts` already reads.
- The gate runs before the handler parses the path's parameters. A route whose handler answers 404 for a malformed
  parameter before it checks the session keeps `"handler"`, or the gate would send every unknown path to sign in.
- This PR changes the kit only. The web server's gate and the first routes to move come in the next step.

## Compliance
`shared/http/server.test.ts`: `gate_admits_and_the_handler_gets_the_session`,
`gate_refusal_is_the_answer_and_the_handler_never_runs`, `gate_runs_only_for_required_routes`,
`cross_site_post_is_denied_before_the_gate`, `gate_that_throws_denies`, `admission_without_a_did_denies`,
`session_handler_called_without_the_gate_throws`, `session_route_without_a_gate_refuses_to_start`,
`did_limit_counts_the_gates_did` and `refused_request_spends_no_did_token`.
