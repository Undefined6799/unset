---
status: Accepted
date: "2026-11-23"
accepted:
  at: "2026-11-23T13:00:14Z"
  head: 18d5a0a9bfdf76b82379fe161214b8e6ad716b74
  line: "Merge 1962 at d7c6cd6 and 1994 at 18d5a0a"
  merged: 810d3dbb5f3d23b522fa3b20a28daefab03ffc6f
step: P1.22d
supersedes:
  - adr: "0054"
    part: "decision 4, last sentence: the public and profile groups keep their policies and send no script"
amends:
  - adr: "0062"
    part: "decision 7 and the JSON-LD alternative: the reason given, that the public page ships no script element"
  - adr: "0069"
    part: "decision 5, second sentence: public, sign-in and blocked pages still run no script"
  - adr: "0070"
    part: "decision 5, last clause: public pages stay script-free"
  - adr: "0073"
    part: "decision 2, last sentence, and 'public pages load no script at all' under what still holds"
  - adr: "0108"
    part: "point 3 and the third alternative: the bell is a link only in a browser that runs no script"
---
# 0114 — Our own script may run on every page; the page without script stays as the fallback

Alex, 2026-11-23, in the project chat. At 03:48Z: "I think script is fine. It's also even why we incorporated Bit UI,
which also has script. [...] it just makes the app like less good, and I disagree with it." At 03:49Z: "it's fine
that the app has nice fallback, like if there's no script, like I agree with that, but then we should not like stop
everything because we don't want to run script, right? So like script is for whoever has script enabled, and then
like if you disable JavaScript, then let's have a nice fallback for that case as well."

## Context

Two different things have been called "no script" here.

**The page works without script.** No record states it as one rule. It is a clause in ADRs 0054 (decision 3), 0068,
0073, 0074, 0078, 0081, 0082 and 0085, and a test suite: `tests/e2e/nojs.spec.ts` opens every page with script off,
and `cards-nojs.spec.ts` adds, edits, moves and deletes cards that way; about 70 of the 497 browser tests, each run
in three browsers.

**Some pages run no script at all.** This one is a security control. The root layout sets `csr = false`
(`interfaces/web/src/routes/+layout.ts`), so a page runs SvelteKit's client only when its `+page.ts` opts in. The
`public` group's header has no `script-src` under `default-src 'none'` (`interfaces/web/src/lib/server/csp.ts`), so
there a script could not run even if one were injected. That covers home, the legal pages, `/join`,
`/request-invite`, the public profile `/@handle` and every refusal page. Plan §5.4 gives it as one of three reasons
the public profile may live on the app's own origin ("the page runs no script under a strict CSP"), ADR 0054 lists
it under what holds, ADRs 0069, 0070 and 0073 repeat it, and ADR 0108 rejected running the bell's script on those
pages because it "loosens ADR 0054's no-script groups". Tests pin it: `csp.test.ts` `zero_script_groups_pinned`,
`public-pages.test.ts` and `public-profile.test.ts` (no `script-src`, no `<script`), `headers.spec.ts`, and
`lighthouserc.json` (script size 0 on those addresses). Plan §6.1 budgets `/@handle` at "0 bytes of JS".

What the second rule has cost. On home, the profiles and the legal pages the bell is a link, not its panel, and
times read in UTC (ADR 0108 point 3). JSON-LD was put off (ADR 0062). The editor notes chose no Copy button for code
on the public page and ruled CodeMirror out partly for this (`plans/editor/table-and-code-tools-assessment.md` in
the project files). And where a stock shadcn-svelte control does nothing until its script runs, we wrote our own
native one (`choice.svelte`, `search-ai-fields.svelte`, `profile-header.svelte`), against the rule to use the
library as shipped. The fallback became the ceiling.

What it has protected. Member-written content reaches other people's browsers on the public profile. Two defences
stand there today: the content is never markup (a typed block tree drawn as text nodes; no `{@html}` anywhere, held
by `scripts/guards/inner-html.ts`; links through `safeHref`), and the page could not run a script if that failed.

Why it was recorded as a control. Plan §5.4: "Review 08 argued for serving the profile on the handle host to
separate user content from editor cookies"; the plan kept the profile on the app's origin and answered with three
reasons, the first being that the page runs no script under a strict CSP. ADR 0054 decision 4 states no reason of
its own: it loosened the app group's policy for SvelteKit and listed the script-free groups under what holds. The
concern was never our own script or the library's. It was a member's content running as script on the origin that
holds sessions (Alex, 04:00Z: no concern "unless people could implement their own script").

Why it no longer outweighs its cost. The second of the plan's three reasons is that "the app already shows user
content elsewhere (directory, timeline)", on pages that run script. The script policy was always going to be the
defence there, and it is the defence on the owner's page today: it refuses inline script and every file but ours,
so markup that slipped through a rendering bug still could not run. The script-free rule added a second backstop on
some pages, at the price above, and it could never cover the pages where members will spend their time.

## Decision

1. **Our own script may run on any page of unset.sh**, the public profile, home and the legal pages included. No
   page or group is kept free of script as a rule, and no feature is refused, thinned or designed second because it
   needs script.
2. **Only our own script, under the one policy that exists.** A page that runs the client is sent the app group's
   policy exactly as ADR 0054 decision 4 and ADR 0073 decision 3 leave it: script files only from `/_app/` on our
   origin, SvelteKit's start-up script by its hash, no `'unsafe-inline'`, no eval, Trusted Types required with the
   three named policies, `connect-src 'self'`. This record adds and widens no directive; the policy reaches more
   pages. No script from another host, from the media origin or from a member, on any page, ever.
3. **Nothing loosens until a page is switched on.** A page gets that policy in the step that makes it run the
   client. Until then, and for every response that is not such a page (build files, refusals, the error page for
   an unmatched path), today's headers stay as they are.
4. **Member content stays data.** On every page it is drawn as text nodes from the server's typed blocks, never as
   markup; links pass `safeHref`; pictures come only from the media origin. This was the first defence on public
   pages and stays; with the policy in point 2 it is now what stands between a member's text and a visitor.
5. **The page without script is the floor, not the ceiling.** Every page is still drawn whole by the server, and
   stays usable when the browser runs no script or a script file does not arrive: everything can be read, and
   everything the page lets a person do today without script (sign in, the welcome steps, settings, cards, notices,
   sign out) can still be done through a plain link or form. The fallback may be plainer than the scripted page: it
   may lack a panel, a live preview, a copy button, dragging or the device's own times, and its markup need not
   match. A new feature gets the simplest fallback that keeps reading and saving possible; one that cannot work
   without script says so on the page.
6. **Stock components first.** Where the library's control needs script, use it, and give the page a plain fallback
   for a browser without script. The native controls we already have stay until a step has a reason to change them.
7. **Unchanged:** no `'unsafe-inline'` and no eval; public pages vary on no preference cookie and keep their cache
   rules (plan §5.4); the public profile stays on the app's origin (plan Q5); JSON-LD stays put off, now only on its
   own merits. The chat page on its own origin is another process and is not covered here.

## Alternatives

- **Keep the script-free pages as they are.** The strongest position against a rendering bug, and the lightest
  pages. It keeps the costs under Context and Alex decided against it.
- **Drop the fallback as well.** Less to build and about 70 fewer browser tests. Alex chose to keep it (03:49Z).
  It is also what a visitor gets when a script file is refused or lost: a cold page asks for about 30 files, and
  the edge allows 120 per 10 seconds per address (ADR 0069).
- **A second, narrower script policy for public pages** (no `connect-src`, no Trusted Types policy). SvelteKit's
  client fetches page data and posts enhanced forms, so navigation and the bell would break, and there would be two
  script policies to keep right. Rejected.
- **Serve public profiles from their own origin** (plan Q5), so a script there could never act for the visitor on
  unset.sh. The strongest isolation, but Follow then needs a cross-site hop and there is a second site to run. Not
  needed while member content is text only; it comes back the day a member can supply markup or styles.
- **Any script at all** (inline, third-party). Against Alex's standing rule; not considered further.

## Consequences

- **What loosens.** On a page that shows other members' content, a script may now run. Before, harm needed a
  rendering bug and nothing more could come of it; now a rendering bug plus a way past `script-src` (our own files
  only) would run script as the visitor. The session cookie stays unreadable (`HttpOnly`), but such a script could
  send same-origin requests for a signed-in visitor, which the Origin gate accepts.
- **A new encoder carries member text.** SvelteKit writes a page's data into its start-up script
  (`@sveltejs/kit` 3.2.0, `src/runtime/server/page/data_serializer.js:99`), encoded by `devalue.uneval` (5.9.4,
  `src/utils.js:5`: `<` is written as its Unicode escape), and hashes that script for each response
  (`render.js:552`, `csp.js` `add_script` in hash mode). The owner's page does this today with the owner's own
  text; on a public page it is another member's.
- **A page's data becomes something the browser holds.** Once a page runs the client, SvelteKit sends the whole
  result of its loads, the root layout's included, in the start-up script, drawn or not. It also answers
  `<page>/__data.json` with the same result, and by its source does so for every page route already, whatever `csr`
  says (`src/runtime/server/respond.js:648`, `data/index.js`). So a load on a page other people can open returns
  only what that viewer may see (rule SE-3), and the data address must give the page's own answers on visibility,
  caching and indexing.
- **Budgets.** `/@handle` leaves "0 bytes of JS" for the app pages' 120 KiB warning line once it is switched on;
  its HTML budget stays.
- **The edge.** Visitors' browsers start asking for build files. Whether several visitors behind one address fit
  the `app_files` allowance is measured before a public page is switched on at staging; changing a limit is its own
  decision (ADR 0059).
- **The shell can be the same everywhere.** The bell's panel and device times can come to home, profiles and the
  legal pages; ADR 0108's link becomes what a browser without script gets.
- **Two versions of each page are still tested.** The no-script tests stay; this record removes none.
- **The plan's words change** in the first step that switches a page on: §5.4 ("Zero JavaScript", the group's CSP
  line and the Q5 reason), §6.1 (the `/@handle` budget row) and §8 (Phase 3 exit, "renders with zero JS").

## Compliance

This record changes no code, header or test. The steps that follow it are in the step book: P1.22h (tests only,
needs no acceptance: what a public page's data address answers today), P1.22e (the script policy on a page that
runs the client; the public profile first, with a Threats section, the pinned header tests changed for that page
only, a test that the data sent to each kind of viewer holds nothing the page does not show them, and a browser
test that a profile holding `</script><script>` and an `onerror` attribute as text runs nothing with script on),
P1.22f (the edge's file allowance measured for visitors who share
an address, with a test) and P1.22g (the bell's panel on every page that runs the client). The app header pinned
by value in `tests/integration/web/gate.test.ts` keeps holding point 2; `scripts/guards/inner-html.ts` keeps holding
point 4; `tests/e2e/nojs.spec.ts` and `cards-nojs.spec.ts` keep holding point 5. Acceptance is Alex's line on the
pull request that adds this record.
