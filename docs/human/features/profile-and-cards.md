# Profile and cards

A member's profile and cards are records in that member's own repository. The member edits them in the app. Visitors read the indexed copy, described in [public indexing](public-indexing.md).

## Route

- [`interfaces/web/src/routes/[did=did]/`](../../../interfaces/web/src/routes/[did=did]) is the member's own page, at `/<DID>`. It loads the profile and cards from the member's PDS. Its form actions create, edit, delete and reorder cards, and save the avatar shape. Only the cards the main page's `cards` list names show, in its order, so a new card and its entry in the list are written in one commit, and so are a deleted card and the list without it ([ADR 0086](../decisions/0086-cards-hold-reusable-blocks.md) point 3). The list lives on the `sh.unset.page` record under the key `self`, and the first card creates it ([ADR 0091](../decisions/0091-a-page-record-holds-the-card-list.md)). A path that is not a DID, or another member's DID, is a 404. A visitor is sent to sign in.
- [`interfaces/web/src/routes/profile/`](../../../interfaces/web/src/routes/profile) is `POST /profile`, the one profile save. It has no page: a GET is a 404. The DID is the session's.
- [`interfaces/web/src/routes/settings/profile/`](../../../interfaces/web/src/routes/settings/profile) is the settings page. The profile form posts to `/profile`, and the save returns to `/settings/profile?saved`, so the page says it saved even with no script. Search and AI is on Settings › Privacy ([public indexing](public-indexing.md)).
- [`interfaces/web/src/routes/@[actor]/`](../../../interfaces/web/src/routes/@[actor]) is the public page. It reads the index, not the PDS. The own page's View as public link opens it at `/@<DID>`. It runs the client under the app's script policy ([ADR 0114](../decisions/0114-script-on-every-page-with-a-plain-fallback.md)); its 404, its refusals and its data address keep the public group's fixed policy and carry no script. The server draws the whole page, so it reads the same with script off. A member's text is drawn as text, in the page and in the start-up script alike, and the load returns only what that viewer's page shows, because the browser is sent all of it.

Both pages draw the same profile header ([ADR 0077](../decisions/0077-one-profile-layout.md)): the avatar and display name above the cards. The avatar opens the About panel, a native popover with the headline, handle, place, website, DID and the first Contact button. Click, tap, Enter or Space opens it, with or without script; hover does not.

- [`interfaces/web/src/routes/images/`](../../../interfaces/web/src/routes/images) is `POST /images`, the picture upload. The body is one multipart field, `image` ([`+server.ts`](../../../interfaces/web/src/routes/images/+server.ts)); another field, or a body that ends early, is refused. A card form sends the returned id back as its `image` field ([`card-form.server.ts`](../../../interfaces/web/src/routes/[did=did]/card-form.server.ts)). There is no page: a visitor's GET is a 303 to sign in, and a member's GET is 405 ([`every-answer.test.ts`](../../../tests/integration/web/every-answer.test.ts)). [`policy.ts`](../../../interfaces/web/src/routes/images/policy.ts) requires a session, counts the POST against the profile write limit, and accepts a declared length of at most 65 MiB (68,157,440 bytes). The body may take 120 seconds, the edge's `read_body` ([`deployment/edge/Caddyfile`](../../../deployment/edge/Caddyfile)); once it is read the route has 100 seconds. The gate refuses a non-POST write (405), a body that is not a form (415), and a missing or too-large `Content-Length` (413). A signed-out request is a 303 to `/login`. SvelteKit's Origin check refuses a cross-site form post before the handler. A success is 201 JSON `{ id, width, height, versions }`. A refusal is JSON `{ code }`: `image.missing` is 400, `image.closed` is 403, `image.one_at_a_time` is 409, `image.hourly_limit` and `image.daily_limit` are 429, `image.busy` and `image.timeout` are 503, and every other code is 422. The handler answers 401 `{ code: "auth.required" }` when `locals.did` is missing. Every answer sets `content-type: application/json` and `cache-control: private, no-store`.

## Operation

The own page reads through [`own-profile.server.ts`](../../../interfaces/web/src/routes/[did=did]/own-profile.server.ts) and writes through [`card-writes.server.ts`](../../../interfaces/web/src/routes/[did=did]/card-writes.server.ts). [`card-form.server.ts`](../../../interfaces/web/src/routes/[did=did]/card-form.server.ts) turns the form into card input. [`profile/save.server.ts`](../../../interfaces/web/src/routes/profile/save.server.ts) is the profile save. A failed PDS call goes through [`pds-failure.ts`](../../../interfaces/web/src/lib/server/pds-failure.ts) (`pdsSignInRedirect`).

A picture is taken in by [`upload.server.ts`](../../../interfaces/web/src/routes/images/upload.server.ts). Uploads must be open, then one per member and four in the process, then the allowance (120 an hour, 1,000 a day, and 2 GiB when the account sets no quota, [`library.ts`](../../../domains/content/images/library.ts)), and only then is the body read. Web posts the bytes to review at `REVIEW_URL` ([`compose.ts`](../../../interfaces/web/src/lib/server/compose.ts)). Review accepts JPEG, PNG, WebP or a still AVIF, up to 64 MiB, 110 megapixels and 12,000 px a side ([`UPLOAD_LIMITS`](../../../domains/content/images/standard.ts), [`sniff.ts`](../../../infrastructure/image/sniff.ts), [ADR 0076](../decisions/0076-image-uploads-up-to-64-mib.md)). It keeps a WebP `main` version, longest side at most 4,096 px and at most 5,000,000 bytes, and display widths 480, 960 and 1600 in AVIF and WebP, never wider than the picture ([ADR 0088](../decisions/0088-picture-main-version-webp-5mb.md)). The row is written first, then each version under `drafts/<did>/i/<id>/` in the object store. Saving a card reads `main.webp` and sends it to the member's PDS with [`uploadImageBlob`](../../../infrastructure/pds/blob-upload.ts) (`com.atproto.repo.uploadBlob`). [`libraryFetch`](../../../infrastructure/net-guard/src/libraryFetch.ts) sends that one call under [`atprotoBlobUpload`](../../../infrastructure/net-guard/src/policies.ts). Objects a failed delete left behind are removed by `sweep.image_orphan` ([`image-orphans.ts`](../../../interfaces/web/src/lib/server/image-orphans.ts)).

## Domain rules

[`domains/profile/`](../../../domains/profile) checks the fields and builds the records.

- [`profile.ts`](../../../domains/profile/profile.ts) reads and writes `sh.unset.profile` (display name, headline, location, website).
- [`page.ts`](../../../domains/profile/page.ts) writes the main page `sh.unset.page/self`, which lists the cards in order.
- [`cards.ts`](../../../domains/profile/cards.ts) reads `sh.unset.card` cards, each holding one `sh.unset.block.*` block. A card this version does not accept is hidden.
- [`card-edit.ts`](../../../domains/profile/card-edit.ts) checks a card before it is written.
- [`web-address.ts`](../../../domains/profile/web-address.ts) accepts a plain `http` or `https` address.

The record shapes are [`shared/lexicons/schemas/sh.unset.profile.json`](../../../shared/lexicons/schemas/sh.unset.profile.json), [`sh.unset.page.json`](../../../shared/lexicons/schemas/sh.unset.page.json) and [`sh.unset.card.json`](../../../shared/lexicons/schemas/sh.unset.card.json) with the blocks beside it ([ADR 0051](../decisions/0051-profile-cards-lexicon.md), [ADR 0086](../decisions/0086-cards-hold-reusable-blocks.md), [ADR 0091](../decisions/0091-a-page-record-holds-the-card-list.md)).

The picture's own rules are [`domains/content/images/`](../../../domains/content/images): [`standard.ts`](../../../domains/content/images/standard.ts) for what may be uploaded and the versions kept, and [`library.ts`](../../../domains/content/images/library.ts) for who may upload, the allowance and when a stored image goes.

## Adapter

[`infrastructure/pds/`](../../../infrastructure/pds) talks to the member's PDS: [`profile-record.ts`](../../../infrastructure/pds/profile-record.ts), [`card-records.ts`](../../../infrastructure/pds/card-records.ts), [`pds-call.ts`](../../../infrastructure/pds/pds-call.ts) and [`repo-record.ts`](../../../infrastructure/pds/repo-record.ts). The profile save writes over the stored record with a compare-and-swap.

## Tables and grants

The member's own page stores nothing in Postgres. The records live in the member's repository on their PDS. The indexed copy has its own tables, in [public indexing](public-indexing.md). A picture upload does write rows: `app.image`, `app.image_use` and `app.image_upload` (migration 0035) and `app.image_record` (migration 0037). `core.erase_did` deletes them with the member.

## Tests

Unit tests sit beside the server and domain files (`own-profile.server.test.ts`, `card-writes.server.test.ts`, `card-form.server.test.ts`, `save.server.test.ts`, and the tests in `domains/profile/`). The picture upload: [`upload.server.test.ts`](../../../interfaces/web/src/routes/images/upload.server.test.ts), [`standard.test.ts`](../../../domains/content/images/standard.test.ts) and [`picture-store.server.test.ts`](../../../interfaces/web/src/routes/[did=did]/picture-store.server.test.ts).

Integration: [`tests/integration/web/app/own-page.test.ts`](../../../tests/integration/web/app/own-page.test.ts), [`member-page.test.ts`](../../../tests/integration/web/app/member-page.test.ts), [`tests/integration/web/settings/profile-save.test.ts`](../../../tests/integration/web/settings/profile-save.test.ts), [`settings.test.ts`](../../../tests/integration/web/settings/settings.test.ts). The public page: [`tests/integration/web/public/public-profile.test.ts`](../../../tests/integration/web/public/public-profile.test.ts) pins its script policy by value and holds what each viewer's browser is sent to what their page shows.

End to end: [`tests/e2e/cards.spec.ts`](../../../tests/e2e/cards.spec.ts), [`cards-nojs.spec.ts`](../../../tests/e2e/cards-nojs.spec.ts), [`profile-layout.spec.ts`](../../../tests/e2e/profile-layout.spec.ts), [`profile-header.spec.ts`](../../../tests/e2e/profile-header.spec.ts), [`profile-carousel.spec.ts`](../../../tests/e2e/profile-carousel.spec.ts), [`profile-refusals.spec.ts`](../../../tests/e2e/profile-refusals.spec.ts), and [`public-profile-script.spec.ts`](../../../tests/e2e/public-profile-script.spec.ts), which opens a public page whose every field is hostile text with script on, with script off and with its script files refused.

## When it is off or replaced

There is no switch. [`pdsSignInRedirect`](../../../interfaces/web/src/lib/server/pds-failure.ts) sends a missing scope to `/verify-email` and a dead grant to `/login`. It returns nothing for any other failure, and each caller answers that itself. The session is kept.

The own page treats any other failure as unavailable and shows "We could not load your profile just now." Settings then shows "Your profile could not be loaded" and no form, so a save cannot start from fields that were not loaded. A profile save or a card write that hits the same failure is `profile.pds_unavailable` or `card.pds_unavailable`.

The public page does not call the PDS. It keeps serving the indexed copy.

Picture uploads are closed when `UNSET_ENV` is `prod` or the PDS hostname is `unset.ac`. Otherwise [`uploadsOpen`](../../../domains/content/images/library.ts) opens them only for the origin `https://staging.unset.sh`, the host `localhost`, or a host ending in `.test`. A closed stack's `POST /images` answers 403 `{ code: "image.closed" }` and does not read the body.
