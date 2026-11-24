---
id: session
type: area
status: current
areas: ["[[session]]"]
summary: "Hub for infrastructure/session: the browser session store, keyed by a hash of the cookie, expired by the database clock."
code: [infrastructure/session/index.ts, infrastructure/session/store.ts]
sources: [docs/ai/book/phase-2.md]
importance: normal
related: ["[[web]]", "[[postgres]]", "[[identity]]"]
replaced_by: null
tags: [area, session]
checked: 2026-11-21
---
# session

**What it owns.** The browser session store (P2.03, plan §5.3 "Sessions"), in the trusted base (SE-6) as the
bearer-credential store. It moved here from the [[postgres]] package in P2.03c.

**Files.**
- `store.ts`: `createSessionStore` with `create`, `read`, `destroy`, `destroyAllForDid`, `countLive`, `setEmailConfirmed`
  and `sweep`. `countLive` counts a DID's sessions still within both lifetimes; sign-out uses it to tell whether
  this browser is the member's last one (P1.21d). `index.ts` is the only import path.

**Rules it keeps.**
- A cookie is 32 random bytes in base64url, and `app.session` keys a session by sha256 of those bytes, so a stolen
  row is not a cookie.
- Every expiry is judged by the database's `now()`, one clock for every replica. A session lasts only while its DID
  has a stored OAuth token set (P2.04s).
- `create`, `destroy`, `destroyAllForDid` and `setEmailConfirmed` run on the client the caller passes, inside its
  transaction; reads take their own connection through `withDb`, outside any transaction the handler holds.
- The session read brings the bell with it: the newest entries through `app.inbox`, each with `seen`: this
  browser's own mark (`app.session.notifications_seen_at`, migration 0039, ADR 0085) covers it, or the account's
  (`app.account.notifications_seen_at`, migration 0041, ADR 0090) does and it is not a sign-in alert
  (`older_sessions_only`), or it is a sign-in alert whose own mark (`app.notification.seen_at`, migration 0043, ADR
  0108) a browser signed in before it has set. So one look clears every browser's badge; the browser a sign-in is
  about never sees that alert, so it cannot clear it.
- The server never draws the bell's panel: it draws a link to `/notifications`, and the client opens the panel
  wherever it runs (+layout.svelte `bellOpens`; P1.22g, ADR 0116 points 8 and 9). The shell's data carries the entries
  only on a route whose page runs the client (`runsClient`, policy.ts); a `client: false` route gets
  `{ state: "count", count }` (`BellView`), because a page with no script cannot post the mark (ADR 0108 point 3).
- It never imports the driver or [[postgres]]: the composition root in [[web]] passes postgres's `withClient` over
  the web pool as `withDb`.

**Who uses it.** [[web]]'s composition root (`interfaces/web/src/lib/server/compose.ts`), its routes and sign-out
(`interfaces/web/src/lib/server/sign-out.ts`), and the hourly expiry sweep in `interfaces/web/src/lib/server/sweeps.ts`.

**Links.** [[web]], [[postgres]], [[identity]]; `docs/ai/book/phase-2.md` P2.03.
