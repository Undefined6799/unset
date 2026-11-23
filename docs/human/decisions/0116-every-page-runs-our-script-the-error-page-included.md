---
status: Proposed
date: "2026-11-23"
step: P1.22i
supersedes:
  - adr: "0114"
    part: "point 3: nothing loosens until a page is switched on, and the error page for an unmatched path keeps today's headers"
amends:
  - adr: "0114"
    part: "point 6, last sentence: the native controls we already have stay until a step has a reason to change them"
  - adr: "0114"
    part: "Compliance: P1.22f and P1.22g as booked there"
---
# 0116 — Every page runs our script, the error page included; a page without it is named

Alex, 2026-11-23 20:52Z, in the project chat: "wherever like that navbar shows, like there will be script. And then
I don't think it's an issue, honestly. I think it's fine as long as we provide an alright experience for someone
that disabled it." And: "that behavior of clicking and it's bring you to the chat page, like is fine, but only if I
disable JavaScript [...] error page, like whatever page, all page is going to run script." And: "let's use Bits UI
scripts there. I think they're good. They give like components. They allow you to like navigate with the keyboard.
They improve accessibility." He had been told that script on the error page means turning the app's default round,
from "no script unless a page asks" to "script unless a page says no", and chose that.

## Context

ADR 0114 allowed our own script on any page and kept one brake (its point 3): a page gets the script policy only in
the step that switches it on. The public profile was the first (P1.22e, merged as 60228f5). The brake rests on one
line: the root layout says `csr = false` (`interfaces/web/src/routes/+layout.ts`), so a page runs SvelteKit's client
only when its own `+page.ts` says `csr = true`.

**What still runs no script on a full load.** With the navbar (the core shell): home, the legal pages,
`/request-invite` and the error page. Without it: `/login`, `/join`, `/welcome` and `/welcome/blocked`. Three routes
are never read: `/login/continue` (a hop that leaves at once by a meta refresh), `/prefs/theme` and
`/privacy-notice/seen` (form targets; a GET is answered 405).

**The error page cannot be switched on by itself.** It is one component, `+error.svelte`, drawn in the core shell.
For a load that failed, SvelteKit takes `csr` from the layouts above the error page and never from the page
(`@sveltejs/kit` 3.2.0, `src/runtime/server/page/index.js:272-291`); for an address no route matches it takes it
from the root layout alone (`page/respond_with_error.js:44-46`). So the error page runs the client exactly when the
root layout says so, and then every page that says nothing runs it too. That is the default turned round.

**What the default has given.**
- *It fails closed.* A page someone adds and forgets to mark ships no script and gets the fixed header with no
  `script-src`.
- *The one 404.* A profile that is missing, hidden, erased or unknown answers with the same error page (rule
  SE-2). P1.22e left that page without script so nothing about it could differ.
- *A link to any address runs nothing.* Anyone can send anyone a link to an address that does not exist; today the
  page behind it cannot run a script whatever the address says.

**What the default has never given.** SvelteKit's client does not read `csr` (`src/runtime/client/client.js` has no
check of it; its only mention is a comment at line 909). A member who goes from settings to home has home drawn by
the client, under the policy of the document they loaded first. So `csr = false` has only ever meant "a full load of
this page ships no script", never "this page is not drawn by script". The server also answers every page's data
address whatever `csr` says (ADR 0114, Consequences; P1.22h), so a load that returns more than its page draws is
already readable.

**Two answers are not pages SvelteKit draws.** The gate's refusal page (`lib/server/refusal-page.ts`: too many
requests, the deadline, a body the route does not take) is built by hand before any route runs, and SvelteKit's
last-resort `error.html` is sent when the error page itself fails. Neither shows the navbar.

## Decision

1. **Every page SvelteKit draws runs our client.** The root layout says `csr = true`. That includes the error page:
   for an address no route matches and for a failed load, on every route, signed in or not.
2. **One policy, unchanged.** A document that runs the client is sent the app group's policy exactly as ADR 0114
   point 2 has it: script files only from `/_app/` on our origin, the start-up script by its hash, no
   `'unsafe-inline'`, no eval, Trusted Types, `connect-src 'self'`. This record adds and widens no directive. Still
   no script from another host, from the media origin or from a member, and the session cookie stays `HttpOnly`.
3. **The header follows the document.** The script policy goes out only on an HTML document that SvelteKit drew
   with its client. The hook decides that from what the server itself did (the route's own policy, and whether
   SvelteKit drew a page or the error page), never from anything the request says. That SvelteKit sent a header
   is not the signal: it sends its own on every page it draws, whatever `csr` says (`page/render.js:577-579`).
   Every other answer keeps the fixed header it has today: data addresses, redirects, refusals, endpoints, build
   files and fonts.
4. **What stays without script, by name.**
   - *The gate's refusal page.* It is sent when the server is refusing work. A page that then asks for about 30
     build files would spend the allowance that has just run out (the edge counts them, ADR 0069), and it must stay
     the cheapest answer we have. It shows no navbar, so Alex's rule does not reach it.
   - *SvelteKit's last-resort `error.html`.* It exists for the case where drawing a page failed.
   - *Three routes nobody reads:* `/login/continue`, `/prefs/theme` and `/privacy-notice/seen`. Each keeps
     `csr = false` in its own `+page.ts`, so its own page stays plain. The sign-in hop must not wait for, or depend
     on, a script file. A load that fails on one of them draws the shared error page, which takes `csr` from the
     layouts and so runs the client like every other error page.
   No other page is left out, and none is left out for a security reason: the sign-in, join and welcome pages run
   the same client under the same policy. A page that later turns the client off says so in its own `+page.ts` and
   is added to the named list in the test of point 7 with its reason. That is a tightening and needs no line.
5. **The one 404 stays one (rule SE-2).** The error page is given the shell's data and the error's catalog code,
   and nothing about why. A missing, hidden, erased or unknown profile, asked by the same viewer, gets the
   same status, the same headers and the same bytes, apart from the address they typed where the page shows it.
   The start-up script's hash is in the header, so equal headers mean equal scripts.
6. **Nothing from the request goes into the error page's start-up script.** SvelteKit writes the root layout's
   server data into that script and then hashes it, so the policy cannot catch a fault in what the server wrote
   there: the encoder (`devalue.uneval`) is the only defence for that text. An address no route matches can be any
   text at all. So on the error page the shell's server data holds no text taken from the request's path, query or
   headers; a choice read from a cookie (the theme) is one of its fixed values. The two values that carry the path
   today (the Sign in link's return path and the theme form's) are worked out where they are drawn, from the page's
   own address. For a visitor, the start-up script is then the same bytes for
   every unmatched address of the same depth: SvelteKit writes its file paths relative to the address
   (`page/render.js:120-126`), so the number of slashes shows and nothing else of it. This rests on how we set
   SvelteKit up: with `router.resolution` set to `server`, or an embedded build, it would also write the route's
   parameters into that script (`page/render.js:476-486`). We use neither (the default is `client`,
   `src/core/config/options.js:256`), and the test of this point fails if that changes.
7. **The safety net is a test, not a default.** One test walks every answer the built server gives and pins its
   header by value (Compliance). A route it does not name fails it. It replaces "a forgotten page ships no script"
   with "a page nobody named cannot merge".
8. **With script, the shell is the same on every page, and its controls are the library's.** Wherever the client
   runs the bell opens its panel, times are the device's and the theme changes in place, the error page included.
   The navbar's menus and panels use the stock shadcn-svelte components over Bits UI (`bits-ui` 2.20.6, pinned),
   for their keyboard handling, focus and ARIA roles, in place of our own native ones. ADR 0114 point 6 let the
   native controls stay until a step had a reason; this is the reason for the navbar.
9. **The plain version is what the server draws, and only a browser without script is left with it.** A navbar
   control that opens something in place with script (the bell's panel today) is drawn by the server as a plain
   link or a native control that does the job with a full page. Once the client is ready it takes over, and the
   link's own behaviour no longer applies. Until the client is ready, a press does the plain thing; it is never
   lost. Everything else in ADR 0114 stands: its points 1, 2, 4, 5 and 7, and the rest of point 6.
10. **Order.** This record changes no code. The steps are in the step book (Compliance). Each step that changes a
    page's header or turns the client on is a security change and merges on Alex's typed line (ADR 0059), as P1.22e
    did. Nothing from those steps reaches staging before P1.22f has measured the edge's file allowance.

## Alternatives

- **Keep the default and switch on only the pages with a navbar; leave the error page plain** (ADR 0114 as it
  stood, and what was first recommended to Alex). It keeps all three things the default gives. The navbar would
  then behave one way on every page and another on the error page, and Alex decided against it.
- **Turn the default round but send the error page the fixed header.** The browser would block the script
  SvelteKit had written into the page and report a violation on every error. Rejected.
- **A second error page under a layout that turns the client off**, so that some errors stay plain. More routes
  and layouts for a difference no threat asks for; and by the Context the client would still draw that page when a
  member reaches it by a click.
- **Draw the gate's refusals in the shell, with script.** They would need to pass through SvelteKit's render after
  the gate had already refused, and a "too many requests" page would ask for more. Left as it is; it can be taken
  up again if Alex wants the navbar there.
- **Keep our native navbar controls.** They work without script and cost nothing to load, but their keyboard and
  focus handling is ours to write and test, against the rule to use the library as shipped. Alex chose the library.

## Consequences

- **What loosens: the error page.** A link to any address on unset.sh now opens a page that runs our client.
  Before, nothing could run there. What stands in the way of harm is the script policy (our files only) and point
  6 (nothing from the request in the script the server hashes).
- **What loosens: the default.** A new page runs the client without saying so, and its loads' whole result is in
  the document. No new reader appears, since the data address has always answered it (P1.22h), but a careless load
  is one step easier to find. The rule is unchanged: a load returns only what its viewer's page shows (SE-3).
- **Request text reaches more start-up scripts.** Sign-in, join and request-invite read a query; each page's step
  holds every such value to a parsed shape (rule DM-1) and tests it with hostile text, as P1.22e did for the
  profile's address.
- **The error page now depends on more.** It is still drawn whole by the server and must read without the client:
  with script off, with the script files refused, and when the client fails while starting.
- **Every first visit asks for build files**, an unmatched address included: about 30 for a cold page, against 120
  per 10 seconds per address at the edge (ADR 0069). A refusal page asks for none. P1.22f measures it before
  staging; changing a limit is its own decision (ADR 0059).
- **Budgets.** Home and the legal pages leave "script size 0" for the app pages' 120 KiB warning line.
- **`csr = false` stops meaning safety.** Where it remains it means "nobody reads this route". The docs that
  describe the default (`features/core-shell.md`, the `area/web` note, the `CLAUDE.md` line) change in the step
  that turns it round.
- **Two versions of each page are still tested.** No fallback and no no-script test is removed.

## Compliance

This record changes no code, header or test. The steps, in `docs/ai/book/phase-1.md`:

- **P1.22j** (tests and a refactor, no behaviour change): every page that runs no client today says `csr = false`
  in its own `+page.ts`, so turning the root round later changes the error page and nothing else; and the test of
  point 7 is written against today's answers. It walks, on the built server, every route in the route table as a
  visitor and as a member, each page's data address, an unmatched address, a failed load, each of the gate's
  refusals, a redirect, an endpoint, a build file and a font, and holds for each: the header is one of the pinned
  values, the app policy only on an HTML document; a document has the start-up script exactly when its header
  allows it, and that script's hash is the one in the header; no `'unsafe-inline'`, no eval, no `'self'` and no
  other host in `script-src`; no `<script src>` outside `/_app/`. A route missing from its table fails, and so does
  a layout other than the root that sets `csr`.
- **P1.22k** ([SEC]): the root layout says `csr = true` and the hook follows point 3. Written first: the error
  rows of the table move to the app policy; point 5 as a test over a missing, a hidden, an erased and an
  unknown profile for a visitor and for a member, on the page, on the data address and by a click in a
  browser with script on; point 6 as a test that two different unmatched addresses of one depth give a visitor
  the same start-up script, and so do a failed load on `/@` a hostile handle and on `/@` a missing one of the same
  depth; a browser test with hostile addresses that runs nothing and reports no violation; the error page read
  with script off, with its files refused and with the client failing at start.
- **P1.22g** (changed): home, the legal pages and `/request-invite` drop their `csr = false`; the bell opens its
  panel wherever the client runs (point 8).
- **P1.22l**: `/login`, `/join`, `/welcome` and `/welcome/blocked` drop theirs; the named list of point 4 is then
  the three routes nobody reads.
- **P1.22m**: the navbar's controls move to the stock components (points 8 and 9).
- **P1.22f** (changed): measures a cold home and a cold unmatched address beside the profile, before any of this
  reaches staging.

`tests/integration/web/gate.test.ts` keeps pinning the app header by value (point 2);
`scripts/guards/inner-html.ts` keeps member content as text; `tests/e2e/nojs.spec.ts` and
`cards-nojs.spec.ts` keep the page without script. Acceptance is Alex's line on the pull request that adds this
record.
