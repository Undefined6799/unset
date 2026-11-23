# Profile and cards

A member's profile and cards are records in that member's own repository. The member edits them in the app. Visitors read the indexed copy, described in [public indexing](public-indexing.md).

## Route

- [`interfaces/web/src/routes/[did=did]/`](../../../interfaces/web/src/routes/[did=did]) is the member's own page, at `/<DID>`. It loads the profile and cards from the member's PDS. Its form actions create, edit, delete and reorder cards, and save the avatar shape. Only the cards the main page's `cards` list names show, in its order, so a new card and its entry in the list are written in one commit, and so are a deleted card and the list without it ([ADR 0086](../decisions/0086-cards-hold-reusable-blocks.md) point 3). The list lives on the `sh.unset.page` record under the key `self`, and the first card creates it ([ADR 0091](../decisions/0091-a-page-record-holds-the-card-list.md)). A path that is not a DID, or another member's DID, is a 404. A visitor is sent to sign in.
- [`interfaces/web/src/routes/profile/`](../../../interfaces/web/src/routes/profile) is `POST /profile`, the one profile save. It has no page: a GET is a 404. The DID is the session's.
- [`interfaces/web/src/routes/settings/profile/`](../../../interfaces/web/src/routes/settings/profile) is the settings page. The profile form posts to `/profile`, and the save returns to `/settings/profile?saved`, so the page says it saved even with no script. Search and AI is on Settings › Privacy ([public indexing](public-indexing.md)).
- [`interfaces/web/src/routes/@[actor]/`](../../../interfaces/web/src/routes/@[actor]) is the public page. It reads the index, not the PDS. The own page's View as public link opens it at `/@<DID>`.

Both pages draw the same profile header ([ADR 0077](../decisions/0077-one-profile-layout.md)): the avatar and display name above the cards. The avatar opens the About panel, a native popover with the headline, handle, place, website, DID and the first Contact button. Click, tap, Enter or Space opens it, with or without script; hover does not.

## Operation

The own page reads through [`own-profile.server.ts`](../../../interfaces/web/src/routes/[did=did]/own-profile.server.ts) and writes through [`card-writes.server.ts`](../../../interfaces/web/src/routes/[did=did]/card-writes.server.ts). [`card-form.server.ts`](../../../interfaces/web/src/routes/[did=did]/card-form.server.ts) turns the form into card input. [`profile/save.server.ts`](../../../interfaces/web/src/routes/profile/save.server.ts) is the profile save. A failed PDS call goes through [`pds-failure.ts`](../../../interfaces/web/src/lib/server/pds-failure.ts) (`pdsSignInRedirect`).

## Domain rules

[`domains/profile/`](../../../domains/profile) checks the fields and builds the records.

- [`profile.ts`](../../../domains/profile/profile.ts) reads and writes `sh.unset.profile` (display name, headline, location, website).
- [`page.ts`](../../../domains/profile/page.ts) writes the main page `sh.unset.page/self`, which lists the cards in order.
- [`cards.ts`](../../../domains/profile/cards.ts) reads `sh.unset.card` cards, each holding one `sh.unset.block.*` block. A card this version does not accept is hidden.
- [`card-edit.ts`](../../../domains/profile/card-edit.ts) checks a card before it is written.
- [`web-address.ts`](../../../domains/profile/web-address.ts) accepts a plain `http` or `https` address.

The record shapes are [`shared/lexicons/schemas/sh.unset.profile.json`](../../../shared/lexicons/schemas/sh.unset.profile.json), [`sh.unset.page.json`](../../../shared/lexicons/schemas/sh.unset.page.json) and [`sh.unset.card.json`](../../../shared/lexicons/schemas/sh.unset.card.json) with the blocks beside it ([ADR 0051](../decisions/0051-profile-cards-lexicon.md), [ADR 0086](../decisions/0086-cards-hold-reusable-blocks.md), [ADR 0091](../decisions/0091-a-page-record-holds-the-card-list.md)).

## Adapter

[`infrastructure/pds/`](../../../infrastructure/pds) talks to the member's PDS: [`profile-record.ts`](../../../infrastructure/pds/profile-record.ts), [`card-records.ts`](../../../infrastructure/pds/card-records.ts), [`pds-call.ts`](../../../infrastructure/pds/pds-call.ts) and [`repo-record.ts`](../../../infrastructure/pds/repo-record.ts). The profile save writes over the stored record with a compare-and-swap.

## Tables and grants

The member's own page stores nothing in Postgres. The records live in the member's repository on their PDS. The indexed copy has its own tables, in [public indexing](public-indexing.md).

## Tests

Unit tests sit beside the server and domain files (`own-profile.server.test.ts`, `card-writes.server.test.ts`, `card-form.server.test.ts`, `save.server.test.ts`, and the tests in `domains/profile/`).

Integration: [`tests/integration/web/app/own-page.test.ts`](../../../tests/integration/web/app/own-page.test.ts), [`member-page.test.ts`](../../../tests/integration/web/app/member-page.test.ts), [`tests/integration/web/settings/profile-save.test.ts`](../../../tests/integration/web/settings/profile-save.test.ts), [`settings.test.ts`](../../../tests/integration/web/settings/settings.test.ts).

End to end: [`tests/e2e/cards.spec.ts`](../../../tests/e2e/cards.spec.ts), [`cards-nojs.spec.ts`](../../../tests/e2e/cards-nojs.spec.ts), [`profile-layout.spec.ts`](../../../tests/e2e/profile-layout.spec.ts), [`profile-header.spec.ts`](../../../tests/e2e/profile-header.spec.ts), [`profile-carousel.spec.ts`](../../../tests/e2e/profile-carousel.spec.ts), [`profile-refusals.spec.ts`](../../../tests/e2e/profile-refusals.spec.ts).

## When it is off or replaced

There is no switch. [`pdsSignInRedirect`](../../../interfaces/web/src/lib/server/pds-failure.ts) sends a missing scope to `/verify-email` and a dead grant to `/login`. It returns nothing for any other failure, and each caller answers that itself. The session is kept.

The own page treats any other failure as unavailable and shows "We could not load your profile just now." Settings then shows "Your profile could not be loaded" and no form, so a save cannot start from fields that were not loaded. A profile save or a card write that hits the same failure is `profile.pds_unavailable` or `card.pds_unavailable`.

The public page does not call the PDS. It keeps serving the indexed copy.
