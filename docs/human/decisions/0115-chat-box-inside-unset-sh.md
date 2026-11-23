---
status: Proposed
date: "2026-11-23"
step: P6.02
amends:
  - adr: "0093"
    part: "Context, its line that no sign-in ticket ever sits on an unset.sh page; and the dock deferred in its last paragraph"
  - adr: "0094"
    part: "the count drawn by chat code inside unset.sh, deferred with the dock"
  - adr: "0105"
    part: "decision 5, the Pangolin login on staging.unset.cc"
---
# 0115 — Chat opens in a box inside unset.sh, signed in by the shell's navigation

Proposed 2026-11-23 for P6.02. Alex asked for it on 2026-11-23 at 04:06Z: "I want to be able to message directly with
an unset.sh ... what I want to see is chat inside unset.sh", and reworking the unset.cc page can wait. He also
said at 04:08Z: "No need for the browser pop-up just now. Just the content icon right now is fine." At 04:15:20Z he
chose "Pangolin bypass for everyone" on the decision card "How should the chat box inside staging.unset.sh get past
the Pangolin login?".

## Context
The chat-planning thread (2026-11-20) settled the dock's shape. It is the chat page in a cross-site frame on unset.sh,
and the browser makes it its own chat device, since it keeps a cross-site frame's storage apart. A postMessage
contract joins the two, and there is no dock on a phone. ADR 0093 left the dock for later, along with its sign-in.

A spike on 2026-11-23 (Chromium 157, Playwright, two local sites) found three things:
- A navigation that a frame of unset.cc makes to unset.sh carries no unset.sh session cookie, Lax or Strict. So the
  box cannot start the sign-in hop itself.
- A cookie with `SameSite=None; Partitioned` (CHIPS) set by the frame, from the server or from its own script, is
  kept and sent back on the frame's fetches and after a reload.
- A redirect that answers with `frame-ancestors 'none'` does not stop the frame's navigation.

The chat box review on 2026-11-23 (finding D1) ran a fourth case in Chromium 157.0.8103.78: when **the shell sets the
frame's `src`** to unset.sh's `GET /chat/sign-in`, the request is same-origin, the Lax and Strict cookies arrive, and
web's 303 carries the ticket to the box's page on unset.cc. The shell cannot read the frame's address
(`SecurityError`), and a script that fetches the hop with `redirect: "manual"` sees an opaque redirect. This holds
with third-party cookies blocked and with the shell's sandbox value.

Pangolin's login cookie is `SameSite=Lax` (fosrl/pangolin main `server/auth/sessions/resource.ts`
`serializeResourceSessionCookie`, read 2026-11-23). So the browser never sends it to a frame on another site, and on
staging the box would meet Pangolin's login page.

## Decision
1. **The box is the chat page at `https://<chat>/?dock`, framed by the unset.sh shell** on a wider screen, at the
   first press of the chat icon or of a profile's Message link. A phone keeps the plain link. The door serves that
   one answer with `frame-ancestors <WEB_ORIGIN>` and no `X-Frame-Options`; every other path stays unframable. The
   shell's CSP gains `frame-src <CHAT_DOOR_ORIGIN> <WEB_ORIGIN>/chat/sign-in` alone. The frame is sandboxed without
   top navigation.
2. **Sign-in is the hop, started by the shell's navigation of the frame.** The box makes a one-time value and sets it
   in the door's hop-state cookie, partitioned to the box. It posts the value to the shell, and the shell sets the
   frame's `src` to `GET /chat/sign-in?state=<value>&dock`. web answers as for the hop, with `<door>/?dock#ticket=…`
   in place of the return path. The box takes the ticket from the fragment and redeems it at
   `POST /sign-in/redeem?dock`, which reads the value from that cookie and sets the browser cookie
   `SameSite=None; Partitioned`. No ticket ever reaches unset.sh's script, so ADR 0093's line that no sign-in ticket
   sits on an unset.sh page still holds. (A first version had the shell fetch the ticket from a `POST /chat/dock` and
   pass it on. The review's finding D1 showed that a script on unset.sh could then ask for a ticket bound to a value
   of its own and redeem it elsewhere. That route is gone.) Messages are taken only from the other window and its
   origin. The full exchange is in `apps/chat/core/dock.ts`.
3. **The box is its own chat browser.** It needs the recovery key once, typed in the box, or it sets chat up there
   for an account with no key yet. Renewal starts the box again on the same device. unset.sh's Log out ends its device
   through the queued end that web already makes for every device the session signed in (ADR 0095 decision 5).
4. **The count.** The icon's number comes from the box while it runs, and otherwise from `GET /chat/count`, read
   every 30 seconds while the page is visible. There are no browser pop-ups (Alex, 04:08Z).
5. **Staging.** `staging.unset.cc` gets a Pangolin bypass for everyone (Alex's card). Chat's own sign-in through
   unset.sh is the only gate there. Synapse's client API on staging answers only bearer tokens our servers mint.

## Alternatives
- **A pop-up to unset.cc for sign-in or unlock.** The security pass had typed secrets only on top-level unset.cc. That
  needs unset.sh's COOP relaxed to `same-origin-allow-popups` and a pop-up page with no COOP. It is left for Alex to
  choose (see Consequences). Not built in this first version.
- **Pangolin bypass for one IP, or test only in CI.** These were offered on the card; Alex chose the bypass for
  everyone.
- **Chat on a unset.sh subdomain, so no frame is cross-site.** This undoes ADR 0025's separate site. Not chosen.

## Consequences
- **The recovery key is typed inside a frame,** whose address the member cannot see. A compromised unset.sh could
  draw a look-alike box and ask for the key. Alex is asked whether to move the unlock to a pop-up (Alternatives).
- **Log out leaves the box's local key store in the browser,** encrypted under a lock key the door no longer hands
  out, until the browser clears the partition. Only the server side ends.
- **Safari and Firefox are untested.** Their support for partitioned cookies in a cross-site frame is unverified.
- `CHAT_DOOR_ORIGIN` now also drives the shell's `frame-src`.
- If web cannot give a ticket (the session ended, or the app gate sends the member elsewhere), the frame shows web's
  answer, which refuses to be framed, so the box is blank until the page is reloaded.

## Compliance
- `interfaces/chat-auth/door.test.ts` covers `door.dock_page` and `door.dock_only_root`.
- `tests/integration/chat-auth/door.test.ts` covers `door.redeem_dock`.
- `interfaces/web/src/lib/server/csp.test.ts` covers `narrowed_frames_only_the_chat_door`.
- `tests/integration/web/app/chat-sign-in.test.ts` covers `chat.sign_in_dock`.
- `apps/chat/core/dock.test.ts` covers the box's messages, its state cookie and its count.
- `tests/e2e/chat-two-browsers.chromium.spec.ts` covers `chat_e2e.dock`: the box on unset.sh sets up, accepts,
  reads and sends against real Synapse and MAS.
