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
  (`app.account.notifications_seen_at`, migration 0042, ADR 0090) does and it is not a sign-in alert
  (`older_sessions_only`). So one look clears every browser's badge except for a sign-in alert, which each browser
  clears for itself.
- It never imports the driver or [[postgres]]: the composition root in [[web]] passes postgres's `withClient` over
  the web pool as `withDb`.

**Who uses it.** [[web]]'s composition root (`interfaces/web/src/lib/server/compose.ts`), its routes and sign-out
(`interfaces/web/src/lib/server/sign-out.ts`), and the hourly expiry sweep in `interfaces/web/src/lib/server/sweeps.ts`.

**Links.** [[web]], [[postgres]], [[identity]]; `docs/ai/book/phase-2.md` P2.03.
