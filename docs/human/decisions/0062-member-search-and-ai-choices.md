# 0062 — Members choose whether search engines and AI search may show their public page; AI training is blocked

Status: Proposed (awaiting Alex). Step P3.12s (part 2). Alex, 2026-11-18 20:48Z: AI training blocked for the whole
site with no member switch; under Settings › Profile, "Search and AI" has two switches, search engines and AI search,
both off by default, plus an optional title and description; it ships with the public pages.

## Context
P3.12s serves a member's public profile at `/@handle` from the indexer's copy, always `noindex`. Members are to choose
whether it is found. What each kind of crawler honours decides where the choice can live (checked 2026-11-19 against
each vendor's own page):

- Search engines honour a page's `noindex` (meta tag or `X-Robots-Tag` header), so a per-page switch works.
- OpenAI documents `OAI-SearchBot` (ChatGPT search) and `GPTBot` (training) as independent robots.txt tokens, with no
  meta tag form (developers.openai.com/api/docs/bots). Perplexity documents `PerplexityBot` the same way
  (docs.perplexity.ai/guides/bots). Google documents `Google-Extended` (Gemini training and grounding) as a robots.txt
  token only, separate from Search (developers.google.com/search/docs/crawling-indexing/google-common-crawlers).
  Apple documents `Applebot-Extended` the same way (support.apple.com/en-us/119829), and Common Crawl `CCBot`
  (commoncrawl.org/ccbot).
- More vendors split training from search the same way: Anthropic `ClaudeBot` (training) and `Claude-SearchBot`
  (support.claude.com/en/articles/8896518), Meta `meta-externalagent` (training) and `meta-webindexer` (Meta AI search)
  (developers.facebook.com/docs/sharing/webmasters/web-crawlers), Amazon `Amazonbot` ("may be used to train Amazon AI
  models") and `Amzn-SearchBot` (developer.amazon.com/amazonbot). Ai2 documents `AI2Bot` as a training crawler
  (allenai.org/crawler) but does not say it reads robots.txt. Cohere and ByteDance publish no vendor page naming a
  token (searched 2026-11-19), so they are not named.
- An AI search crawler we do not name follows the `*` group (Amazon says so for `Amzn-SearchBot`), so naming it is
  what makes the member's switch apply.
- Fetchers a person triggers (`ChatGPT-User`, `Perplexity-User`, `Claude-User`, `meta-externalfetcher`, `Amzn-User`)
  say robots.txt may not apply to them.
- robots.txt rules are per path, and the longest match wins (RFC 9309 section 2.2.2), so one file can carry a
  per-member choice as one `Allow` line per page.

These choices are our preferences about how we serve the page, not part of the member's portable identity, so they do
not belong in the public profile record on the PDS: an override title written there would be public before the member
turns indexing on.

## Decision
1. **One app-owned row per member, `app.discoverability`**: `search_engines` and `ai_search` (booleans), an optional
   `search_title` (1 to 70 characters) and `search_description` (1 to 200), and `updated_at`. No row means all off;
   saving everything off deletes the row. `ON DELETE CASCADE` from `app.account`, and `core.erase_did` deletes it
   explicitly and counts it. `web` gets column-list SELECT, INSERT and UPDATE, plus DELETE, and every statement has a
   `did` predicate taken from the session, never from the form.
2. **The settings form is server-only.** `POST /settings/search-and-ai` with a verified session and the one CSRF gate,
   8 KB body cap, the profile limit. The form is parsed once into a typed value: a checkbox is on only when it reads
   `on`; text has no control characters and is counted in code points; unknown or repeated fields are refused.
3. **Search engines:** when `search_engines` is on, the public page drops `noindex` (header and meta tag) and joins
   `/sitemap.xml`. Every other page keeps today's `noindex`.
4. **AI search:** when `ai_search` is on, `/robots.txt` gives `OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`,
   `meta-webindexer` and `Amzn-SearchBot` an `Allow: /@...$` line for that page; every other `/@` path stays
   disallowed for them. With AI search on and search engines off the page still says `noindex`; no vendor says if its
   AI search crawler reads it, so the page may or may not show there, and search engines still do not list it.
5. **AI training is blocked for the whole site**: `GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`,
   `meta-externalagent`, `Amazonbot`, `CCBot` and `AI2Bot` (every training token with a vendor page on 2026-11-19)
   get `Disallow: /`, with no member switch. robots.txt only asks: it cannot stop a crawler that ignores it, one we
   cannot name, or a person who copies a page, and the settings page says so.
6. **robots.txt and the sitemap are built on request** from `app.discoverability` joined with the visible-account
   view, so a hidden, deactivated, taken-down or erased member drops out at the next fetch. Both are capped (10,000
   AI search lines within 450 KiB, after the group's `Disallow: /@`; 50,000 sitemap URLs) and sent with
   `max-age=300` like every public page, since vendors re-read robots.txt about daily. Only `/@` plus handle or DID
   characters are written, so a record cannot inject a directive.
7. **The public page's title and description** use the member's override if set, else their name and headline; plus
   a canonical link, OpenGraph tags and a `summary` card, each escaped by the page's one HTML encoder. No JSON-LD:
   the public page runs no script and ships no script element.
8. **Member links on the public page carry `rel="nofollow ugc"`**, so our ranking is not lent to links a member
   typed.
9. **The settings page says the honest limits**: these are requests crawlers may ignore; changes take hours to days;
   a link a person pastes into an AI tool is fetched anyway; robots.txt is public, so opting into AI search lists the
   page's path there.

## Alternatives
- **Keep the choices in the public profile record.** Rejected: the record is public on the PDS, so the switches and
  any override would be visible to everyone before the member opts in, and other apps would read our serving rules.
- **A training switch per member.** Rejected by Alex (20:48Z): no member is asked to opt in to training.
- **Per-page meta tags for AI crawlers.** Not possible: none of these vendors documents one.
- **A columns-on-`app.account` change.** Rejected: a separate table keeps the grant to `web` to exactly these
  columns and the erasure row separate.
- **JSON-LD `ProfilePage`.** Deferred: it needs a script element on a page whose contract is zero script; revisit if
  search engines show a real gain.
- **A search preview on the settings page.** Deferred to a later step; the form already shows what each field does.

## Consequences
- New personal data (two choices and two optional texts), with a purpose (how we serve the member's own page), a
  lawful basis (the member's consent, given by turning a switch on and withdrawn by turning it off), erasure through
  `core.erase_did`, and export with P4.26. The privacy notice gains a line.
- robots.txt grows one line per member who opted into AI search; the file is public by design and lists only them.
- Each fetch of robots.txt or the sitemap runs one capped query under the `default` rate limit; the table holds only
  opted-in members, so today that is a handful of rows. Before they number in the thousands, a later change keeps the
  built file in memory for its max-age; not now, as at our size it would only add a cache to reason about.
- Turning a switch off is immediate on our side; search engines and AI services can take hours to days to act.
- A new crawler token is a code change to `domains/profile/crawlers.ts` with its vendor page cited.

## Compliance
- `tests/integration/web/public/search-and-ai.test.ts`: off by default, a signed-out save is refused, saving on drops
  `noindex` and fills robots.txt and the sitemap, a hidden account drops out, bad forms are refused, off restores
  `noindex`, and a read that fails keeps `noindex` while robots.txt and the sitemap answer 5xx.
- `domains/profile/crawlers.test.ts` and `discoverability.test.ts`: directives, caps, unsafe paths and form parsing.
- `tests/integration/postgres/erase-did.test.ts` and the grant matrix: erasure covers the table and `web` holds only
  the listed columns.
