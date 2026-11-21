---
id: session
type: area
status: current
areas: ["[[session]]"]
summary: "Hub for infrastructure/session: the browser session store, keyed by a hash of the cookie, expired by the database clock."
code: [infrastructure/session/index.ts, infrastructure/session/store.ts]
sources: [docs/ai/book/phase-2.md]
importance: normal
related: ["[[http]]", "[[postgres]]", "[[identity]]"]
replaced_by: null
tags: [area, session]
checked: 2026-11-21
---
# session

**What it owns.** The browser session store (P2.03, plan §5.3 "Sessions"), in the trusted base (SE-6) as the
bearer-credential store. It moved here from infrastructure/postgres/session/ in P2.03c.

**Files.**
- `store.ts`: `createSessionStore` with `create`, `readOnce`, `destroy`, `destroyAllForDid`, `setEmailConfirmed` and
  `sweep`. `index.ts` is the only import path.

**Rules it keeps.**
- A cookie is 32 random bytes in base64url, and `app.session` keys a session by sha256 of those bytes, so a stolen
  row is not a cookie.
- Every expiry is judged by the database's `now()`, one clock for every replica. A session lasts only while its DID
  has a stored OAuth token set (P2.04s).
- `create`, `destroy`, `destroyAllForDid` and `setEmailConfirmed` run on the client the caller passes, inside its
  transaction; reads take their own connection through `withDb`, outside any transaction the handler holds.
- The session read brings the bell with it: the newest entries through `app.inbox`, each with `seen`, whether this
  browser's own mark (`notifications_seen_at`, migration 0039, ADR 0085) covers it. The mark is per session on
  purpose: one browser never clears another's badge.
- It never imports the driver or [[postgres]]: the composition root in [[http]] passes postgres's `withClient` over
  the web pool as `withDb`.

**Who uses it.** [[http]]'s composition root (`interfaces/http/compose.ts`), its routes, and the hourly expiry
sweep in `interfaces/http/jobs/sweeps.ts`.

**Links.** [[http]], [[postgres]], [[identity]]; `docs/ai/book/phase-2.md` P2.03.
