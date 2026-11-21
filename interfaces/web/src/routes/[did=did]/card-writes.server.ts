// Ported from interfaces/http/card-writes.ts (P1.20i), import path only; that copy went with P1.20k.
// The card writes behind the card routes (ADR 0051): create, edit, delete and reorder a member's cards on their own
// PDS. Records are built by domains/profile; the PDS calls come from infrastructure/pds through `CardStore`, bound to
// the session's DID in the composition root, so no write here can reach another member's repo.

import { isDeepStrictEqual } from "node:util";
import {
  type AvatarShape,
  CARDS_MAX,
  type CardContent,
  type CardError,
  type CardKey,
  type CardSurface,
  type CardVersion,
  type CardWidth,
  type DraftImageId,
  fitsPage,
  inSizeOrder,
  type ProfileError,
  pageCards,
  parseCardVersion,
  pictureLink,
  type RepoDid,
  reorderCards,
  toCardRecord,
  withAvatarShape,
  withCardListed,
  withCardOrder,
  withCardUnlisted,
} from "@unset/domains-profile";
import type {
  BuiltRecord,
  CardChange,
  CardList,
  ListedOutcome,
  PdsResult,
  ProfileChange,
  SaveManyOutcome,
  SaveOutcome,
  StoredRecord,
  UploadedBlob,
} from "@unset/infrastructure-pds";
import { pdsSignInRedirect } from "../../lib/server/pds-failure.ts";

/** The member's own card and profile records, already bound to their DID and this request's deadline. */
export type CardStore = {
  readonly list: () => Promise<PdsResult<CardList>>;
  /** The CID of the repo's head commit, read before the reads a write depends on. */
  readonly head: () => Promise<PdsResult<string>>;
  /** The stored profile record, or null when there is none. */
  readonly profile: () => Promise<PdsResult<StoredRecord | null>>;
  /** A record key for a card web names before writing it (a TID, as the PDS picks). */
  readonly newKey: () => CardKey;
  /** A card created or deleted with the profile that lists it, in one commit, only if the head is still `swapCommit`. */
  readonly write: (
    change: { readonly card?: CardChange; readonly profile?: ProfileChange },
    swapCommit: string,
  ) => Promise<PdsResult<ListedOutcome>>;
  readonly save: (
    key: CardKey,
    build: (existing: unknown) => BuiltRecord<CardError>,
  ) => Promise<PdsResult<SaveOutcome<CardError | "card.missing">>>;
  /** Writes over the cards all at once, only if the repo's head is still `swapCommit`. */
  readonly saveMany: (
    updates: readonly { readonly key: CardKey; readonly record: Readonly<Record<string, unknown>> }[],
    swapCommit: string,
  ) => Promise<PdsResult<SaveManyOutcome>>;
  readonly saveProfile: (
    build: (existing: unknown) => BuiltRecord<ProfileError>,
  ) => Promise<PdsResult<SaveOutcome<ProfileError>>>;
};

/**
 * A picture card's publish step (ADR 0070 point 5), bound to the member and their card records' URIs in the
 * composition root: a use of one of their own uploads, its main version from our store, and the upload to their PDS.
 * Each database call is its own short transaction, never around a network call (DA-4). Taking a use back runs under
 * its own deadline, so a request that ran out of time still settles.
 */
export type PictureStore = {
  /**
   * Records the card's use of the draft: its pixel size and the lease (this request's hold on the use); null when the
   * draft is not theirs.
   */
  readonly use: (
    id: DraftImageId,
    key: CardKey,
  ) => Promise<{ readonly width: number; readonly height: number; readonly lease: string } | null>;
  /**
   * Gives up this request's hold, its write surely not landed; the use goes only if no other save holds it and no
   * write settled it (so a use the stored card shows stays).
   */
  readonly release: (id: DraftImageId, key: CardKey, lease: string) => Promise<void>;
  readonly main: (
    id: DraftImageId,
  ) => Promise<{ readonly kind: "ok"; readonly bytes: Uint8Array } | { readonly kind: "missing" | "unavailable" }>;
  readonly upload: (bytes: Uint8Array) => Promise<PdsResult<UploadedBlob>>;
  /** Notes the CID the member's PDS gave the draft, by which a settled write names it. */
  readonly published: (id: DraftImageId, link: string) => Promise<void>;
  /**
   * A write of the card landed as commit `rev`, showing the picture with CID `link` (null: none). Settled in revision
   * order: the newest write leaves the record that picture's use alone; either way the holds in `mine` go.
   */
  readonly settle: (
    key: CardKey,
    rev: string,
    link: string | null,
    mine: readonly { readonly id: DraftImageId; readonly lease: string }[],
  ) => Promise<void>;
  /** The card's record is gone; its uses go. */
  readonly drop: (key: CardKey) => Promise<void>;
};

export type CardFailure =
  | CardError
  | ProfileError
  | "card.missing"
  | "card.too_many"
  | "card.overflow"
  | "card.cards_changed"
  | "card.save_too_large"
  | "card.save_partial"
  | "card.list_incomplete"
  | "card.conflict"
  | "card.pds_unavailable"
  | "card.image_missing"
  | "card.image_unavailable"
  | "card.image_too_large"
  | "profile.conflict"
  | "profile.pds_unavailable";
/** A card a Save of several wrote, and the version (record CID) the PDS gave it. */
export type CardWritten = { readonly key: CardKey; readonly version: CardVersion };
export type CardWrite =
  /** `versions`, in a Save of several, are the written cards whose new version the PDS named. */
  | { readonly kind: "saved"; readonly versions?: readonly CardWritten[] }
  /**
   * `field`, when given, is the form field to blame (the card editor shows the refusal beside it); `card`, in a save
   * of several cards, is the card it is about; `saved`, in a Save written only in part, are the cards that were, and
   * `versions` the new versions of those the PDS named.
   */
  | {
      readonly kind: "failed";
      readonly code: CardFailure;
      readonly field?: string;
      readonly card?: CardKey;
      readonly saved?: readonly CardKey[];
      readonly versions?: readonly CardWritten[];
    }
  /** The PDS grant is gone or lacks a scope; the sign-in pages take over. */
  | { readonly kind: "redirect"; readonly location: string };

/** One changed card in a Save of several: what the member wrote, and the version their editor opened. */
export type CardEdit = {
  readonly key: CardKey;
  readonly version: CardVersion;
  readonly content: CardContent;
  readonly width: CardWidth;
  readonly surface?: CardSurface;
};

export type CardWrites = {
  /**
   * `key`, when given, is the one the add form named, so the same form sent twice (a double click, a retry after a
   * lost answer) adds one card: a key already stored is answered as saved.
   */
  readonly create: (content: CardContent, width: CardWidth, surface?: CardSurface, key?: CardKey) => Promise<CardWrite>;
  readonly save: (key: CardKey, content: CardContent, width: CardWidth, surface?: CardSurface) => Promise<CardWrite>;
  /** Every changed card at once, all or none (ADR 0074). */
  readonly saveAll: (edits: readonly CardEdit[]) => Promise<CardWrite>;
  readonly remove: (key: CardKey) => Promise<CardWrite>;
  readonly reorder: (requested: unknown) => Promise<CardWrite>;
  /** The avatar's shape, written into the profile record (sh.unset.profile avatarShape). */
  readonly avatarShape: (shape: AvatarShape) => Promise<CardWrite>;
};

const SAVED: CardWrite = { kind: "saved" };
/** The first try and one more after a refused swap; never a third, so a busy repo cannot hold the request. */
const CREATE_ATTEMPTS = 2;
const SAVE_ALL_ATTEMPTS = CREATE_ATTEMPTS;
const failed = (code: CardFailure, field?: string): CardWrite =>
  field === undefined ? { kind: "failed", code } : { kind: "failed", code, field };

type PictureContent = Extract<CardContent, { kind: "image" }>;
/** A picture card whose picture is a new upload, which must be published before the card can be written. */
const draftOf = (content: CardContent): DraftImageId | null =>
  content.kind === "image" && content.picture.kind === "draft" ? content.picture.id : null;
/** A use this request recorded: kept when its card was written, or may have been; released when surely not. */
type Held = {
  readonly key: CardKey;
  readonly id: DraftImageId;
  readonly lease: string;
};
/**
 * A card write that landed: the picture its record shows now, and its commit's revision (null when the PDS gave
 * none, so it cannot be ordered against other writes of the card and settles nothing).
 */
type Landed = { readonly key: CardKey; readonly shown: string | null; readonly rev: string | null };
const landed = (key: CardKey, written: unknown, rev: string | undefined): Landed => ({
  key,
  shown: pictureLink(written),
  rev: rev ?? null,
});
/**
 * Whether a stored card is the record a create would write: the same fields as JSON, its creation time aside. A
 * picture stored in another JSON form compares unequal, so a resend adds a second card rather than losing one.
 */
function sameCard(stored: unknown, record: unknown): boolean {
  const plain = (value: unknown): unknown => {
    const { createdAt: _at, ...rest } = JSON.parse(JSON.stringify(value ?? null)) ?? {};
    return rest;
  };
  return isDeepStrictEqual(plain(stored), plain(record));
}

/** A write the PDS did not answer may still have landed. */
const unanswered = (result: PdsResult<unknown>): boolean => result.kind === "transient";

/** `owner` is the member whose repository the store writes; the card list names their cards by address. */
export function cardWrites(owner: RepoDid, store: CardStore, now: () => string, pictures: PictureStore): CardWrites {
  const pdsFailure = (result: Exclude<PdsResult<unknown>, { kind: "ok" }>): CardWrite => {
    const location = pdsSignInRedirect(result);
    return location === null ? failed("card.pds_unavailable") : { kind: "redirect", location };
  };

  /**
   * After the write. A card that landed settles its record's uses in revision order, so concurrent saves of one card
   * end with the uses of the picture the last write shows, whichever settles first (the PDS's commit order, not ours).
   * A card that surely did not land gives up this request's holds; a use goes only when no other save holds it and no
   * write settled it (one the stored card shows stays). Where the PDS did not answer (`unsure`), the write may have
   * landed, so the holds stay: a use left behind costs storage, while one taken from a shown picture would lose it.
   */
  const settle = async (held: readonly Held[], written: readonly Landed[], unsure: boolean): Promise<void> => {
    for (const card of written) {
      const mine = held.filter((use) => use.key === card.key);
      if (card.rev !== null) await pictures.settle(card.key, card.rev, card.shown, mine);
    }
    if (unsure) return;
    for (const use of held) {
      if (!written.some((card) => card.key === use.key)) await pictures.release(use.id, use.key, use.lease);
    }
  };

  /**
   * A new picture made publishable, in order: the use first (so no sweep can take the upload mid-save, and the size
   * is the member's own row), then its main version, then the upload to their PDS. Any later failure takes the use
   * back, a thrown one too (the database failing while noting the CID), before the error goes on. A card with no new
   * picture passes unchanged.
   */
  const publish = async (
    content: CardContent,
    key: CardKey,
  ): Promise<{ ok: true; content: CardContent; held: Held | null } | { ok: false; failed: CardWrite }> => {
    const id = draftOf(content);
    if (id === null) return { ok: true, content, held: null };
    const use = await pictures.use(id, key);
    if (use === null) return { ok: false, failed: failed("card.image_missing", "image") };
    const held: Held = { key, id, lease: use.lease };
    try {
      return await publishHeld(content, held, use);
    } catch (error) {
      await settle([held], [], false);
      throw error;
    }
  };

  /** `publish` once the use is held: the main version, the upload, then the CID noted on the image. */
  const publishHeld = async (
    content: CardContent,
    held: Held,
    use: { readonly width: number; readonly height: number },
  ): Promise<{ ok: true; content: CardContent; held: Held } | { ok: false; failed: CardWrite }> => {
    const { id } = held;
    const main = await pictures.main(id);
    if (main.kind !== "ok") {
      await settle([held], [], false);
      const code = main.kind === "missing" ? "card.image_missing" : "card.image_unavailable";
      return { ok: false, failed: failed(code, "image") };
    }
    const blob = await pictures.upload(main.bytes);
    if (blob.kind !== "ok") {
      await settle([held], [], false);
      // ADR 0088: a PDS that refuses the picture's size (HTTP 413) gets no smaller copy; the member is told once.
      if (blob.kind === "rejected" && blob.status === 413)
        return { ok: false, failed: failed("card.image_too_large", "image") };
      return { ok: false, failed: pdsFailure(blob) };
    }
    await pictures.published(id, blob.value.ref.$link);
    const published: PictureContent = {
      ...(content as PictureContent),
      picture: { kind: "published", blob: blob.value, width: use.width, height: use.height },
    };
    return { ok: true, content: published, held };
  };

  /**
   * Each edit with its new picture published, in order; `held` gains each use. The first refusal stops the Save; a
   * thrown failure takes back the uses made before it, then goes on.
   */
  const publishAll = async (
    edits: readonly CardEdit[],
    held: Held[],
  ): Promise<{ ok: true; edits: CardEdit[] } | { ok: false; failed: CardWrite }> => {
    const out: CardEdit[] = [];
    for (const edit of edits) {
      let published: Awaited<ReturnType<typeof publish>>;
      try {
        published = await publish(edit.content, edit.key);
      } catch (error) {
        await settle(held, [], false);
        throw error;
      }
      if (!published.ok) {
        const refusal = published.failed;
        return { ok: false, failed: refusal.kind === "failed" ? { ...refusal, card: edit.key } : refusal };
      }
      if (published.held !== null) held.push(published.held);
      out.push({ ...edit, content: published.content });
    }
    return { ok: true, edits: out };
  };

  /** The repo's head, then the cards and the profile as they stand on it, for a write that swaps on that head. */
  const readRepo = async (): Promise<
    | { readonly ok: true; readonly head: string; readonly list: CardList; readonly profile: StoredRecord | null }
    | { readonly ok: false; readonly failed: CardWrite }
  > => {
    const head = await store.head();
    if (head.kind !== "ok") return { ok: false, failed: pdsFailure(head) };
    const list = await store.list();
    if (list.kind !== "ok") return { ok: false, failed: pdsFailure(list) };
    const profile = await store.profile();
    if (profile.kind !== "ok") return { ok: false, failed: pdsFailure(profile) };
    return { ok: true, head: head.value, list: list.value, profile: profile.value };
  };

  const outcome = <C extends CardFailure>(result: PdsResult<SaveOutcome<C>>): CardWrite => {
    if (result.kind !== "ok") return pdsFailure(result);
    if (result.value.kind === "conflict") return failed("card.conflict");
    return result.value.kind === "refused" ? failed(result.value.code) : SAVED;
  };

  return {
    // The page reads CARDS_MAX cards, so one past it would be stored and never shown. The count, the profile's list
    // and the create are tied to one repo state (DA-4: compare-and-swap at the PDS): the head is read first, and the
    // card and the profile listing it are written in one commit swapping on it (ADR 0086 point 3: only listed cards
    // show, so the two never land apart), so a card or profile written elsewhere meanwhile (another tab) makes the PDS
    // refuse it and nothing is written. Read once more then, since an unrelated write to the repo also moves the head;
    // a second refusal asks the member to save again. A list cut short by the read budget (card-records.ts) is not a
    // count: the add is refused. The card's key is picked once, before the first write (a picture's use is recorded
    // under it), and a retry reuses it and the published picture.
    create: async (content, width, surface, named) => {
      const early = draftOf(content) === null ? toCardRecord(content, width, null, now(), surface) : null;
      if (early !== null && !early.ok) return failed(early.code, early.field);
      let record = early?.record ?? null;
      let held: Held | null = null;
      let key = named ?? store.newKey();
      const done = async (result: CardWrite, unsure = false) => {
        await settle(held === null ? [] : [held], [], unsure);
        return result;
      };
      /** Publishes a new picture under `key` and builds the record; null when there is nothing to do. */
      const prepare = async (): Promise<CardWrite | null> => {
        if (record !== null) return null;
        const published = await publish(content, key);
        if (!published.ok) return published.failed;
        held = published.held;
        const built = toCardRecord(published.content, width, null, now(), surface);
        if (!built.ok) return done(failed(built.code, built.field));
        record = built.record;
        return null;
      };
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
        const repo = await readRepo();
        if (!repo.ok) return done(repo.failed);
        const { list, profile } = repo;
        // The form's key already stored: the same form sent again is answered as saved (checked before the count, so
        // a resend at the last free place is too). A page that kept an old key (back to an earlier draw, a refresh
        // that failed after a save) carries other words, so that is a new card, under a fresh key.
        const stored = list.cards.find((card) => card.key === key);
        if (stored !== undefined) {
          const unready = await prepare();
          if (unready !== null) return unready;
          if (sameCard(stored.value, record)) return done(SAVED);
          await settle(held === null ? [] : [held], [], false);
          held = null;
          record = early?.record ?? null;
          key = store.newKey();
        }
        if (list.overflow || list.cards.length >= CARDS_MAX) return done(failed("card.too_many"));
        if (!list.complete) return done(failed("card.list_incomplete"));
        const listed = withCardListed(owner, key, profile?.value ?? null, now());
        if (!listed.ok) return done(failed(listed.code));
        const unready = await prepare();
        if (unready !== null) return unready;
        if (record === null) return done(failed("card.cards_changed")); // prepare built it; this only narrows the type
        // All the member's cards must still fit one page (domains/profile MAX_PAGE_BYTES), counted on this same list.
        if (!fitsPage(list.cards, [{ key: null, record }])) return done(failed("card.page_full"));
        const card: CardChange = { kind: "create", key, record };
        const written = await store.write({ card, profile: profileChange(listed.record, profile) }, repo.head);
        if (written.kind !== "ok") return done(pdsFailure(written), unanswered(written));
        if (written.value.kind === "too_large") return done(failed("card.save_too_large"));
        // A new record had no uses before; one with a picture settles its held use under the create's revision.
        if (written.value.kind === "written") {
          if (held !== null) await settle([held], [landed(key, record, written.value.rev)], false);
          return SAVED;
        }
      }
      return done(failed("card.cards_changed"));
    },
    // The page's size is counted on the member's cards as listed just before the write. The write swaps on this card
    // alone, so a card another tab grows meanwhile can still pass the size; the index then skips the one that does not
    // fit and counts it (indexStore.ts), so the page itself never passes MAX_PAGE_BYTES.
    save: async (key, content, width, surface) => {
      const listed = await store.list();
      if (listed.kind !== "ok") return pdsFailure(listed);
      if (!listed.value.complete) return failed("card.list_incomplete");
      const published = await publish(content, key);
      if (!published.ok) return published.failed;
      let written: unknown = null;
      const saved = await store.save(key, (existing) => {
        const built = toCardRecord(published.content, width, existing, now(), surface);
        if (built.ok && !fitsPage(listed.value.cards, [{ key, record: built.record }])) {
          return { ok: false, code: "card.page_full" };
        }
        written = built.ok ? built.record : null;
        return built;
      });
      const result = outcome(saved);
      const held = published.held === null ? [] : [published.held];
      const landedRev = saved.kind === "ok" && saved.value.kind === "saved" ? saved.value.rev : undefined;
      const cards = result.kind === "saved" ? [landed(key, written, landedRev)] : [];
      await settle(held, cards, unanswered(saved));
      return result;
    },
    // The versions and the write are tied to one repo state (DA-4: compare-and-swap at the PDS): the head is read
    // first, the list after it, and the write swaps on that head, so a card written elsewhere since either read makes
    // the PDS refuse and nothing is written. Each card must still be the version the member's editor opened; one that
    // is not is refused by name, so their text is never written over another tab's. Any other write to the repo (a
    // like) also moves the head, so it is read once more; a second refusal asks the member to save again.
    saveAll: async (edits) => {
      if (edits.length === 0) return SAVED;
      // New pictures are published once, after the first pass of the checks and before the first write; a retry on a
      // moved head reuses them. Every use is settled at the end by which cards were written.
      let ready: CardEdit[] | null = null;
      const held: Held[] = [];
      let cards: { readonly key: CardKey; readonly record: unknown }[] = [];
      const done = async (result: CardWrite, written: readonly string[], unsure = false, rev?: string) => {
        await settle(
          held,
          cards.filter((card) => written.includes(card.key)).map((card) => landed(card.key, card.record, rev)),
          unsure,
        );
        return result;
      };
      const all = edits.map((edit) => edit.key);
      for (let attempt = 0; attempt < SAVE_ALL_ATTEMPTS; attempt += 1) {
        const head = await store.head();
        if (head.kind !== "ok") return done(pdsFailure(head), []);
        const listed = await store.list();
        if (listed.kind !== "ok") return done(pdsFailure(listed), []);
        // The page budget counts every card, so a list cut short cannot judge one (Codex review of #1911).
        if (!listed.value.complete) return done(failed("card.list_incomplete"), []);
        const checked = checkEdits(edits, listed.value);
        if (checked !== null) return done(checked, []);
        if (ready === null) {
          const published = await publishAll(edits, held);
          if (!published.ok) return done(published.failed, []);
          ready = published.edits;
        }
        const built = buildEdits(ready, listed.value, now());
        if (!built.ok) return done(built.failed, []);
        if (!fitsPage(listed.value.cards, built.updates)) return done(failed("card.page_full"), []);
        // Cards that shrink go first: a Save past one write's size lands in several commits, and the page must fit
        // after each of them, as the index judges it.
        const updates = inSizeOrder(listed.value.cards, built.updates);
        cards = updates;
        const saved = await store.saveMany(updates, head.value);
        if (saved.kind !== "ok") return done(pdsFailure(saved), [], unanswered(saved));
        if (saved.value.kind === "saved") {
          const versions = writtenVersions(edits, saved.value.versions);
          return done(versions.length === 0 ? SAVED : { kind: "saved", versions }, all, false, saved.value.rev);
        }
        if (saved.value.kind === "too_large") return done(tooLarge(edits, saved.value.key), []);
        // The call that failed may still have landed, so the cards it carried keep their uses.
        if (saved.value.kind === "partial") {
          const versions = writtenVersions(edits, saved.value.versions);
          const result = partly(edits, saved.value.saved);
          const answer = versions.length === 0 ? result : { ...result, versions };
          return done(answer, ofEdits(edits, saved.value.saved), true, saved.value.rev);
        }
      }
      return done(failed("card.cards_changed"), []);
    },
    // The card and its entry in the profile's list go in one commit on the head read first (ADR 0086 point 3), so a
    // list never keeps a card it lost or loses one another tab added; a moved head is read once more. Only a card the
    // list read holds is deleted (the PDS refuses to delete a missing record); a list cut short that lacks it cannot
    // say. A profile another client broke is left as it is: an entry with no card shows nothing. A deleted card's
    // record uses no picture any more; their copies go a week later.
    remove: async (key) => {
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
        const repo = await readRepo();
        if (!repo.ok) return repo.failed;
        const stored = repo.list.cards.some((card) => card.key === key);
        if (!stored && !repo.list.complete) return failed("card.list_incomplete");
        const unlisted = withCardUnlisted(owner, key, repo.profile?.value ?? null, now());
        const record = unlisted.ok ? unlisted.record : null;
        const change = {
          ...(stored ? { card: { kind: "delete", key } as const } : {}),
          ...(record === null ? {} : { profile: profileChange(record, repo.profile) }),
        };
        const written = await store.write(change, repo.head);
        if (written.kind !== "ok") return pdsFailure(written);
        if (written.value.kind === "too_large") return failed("profile.too_long");
        if (written.value.kind === "written") {
          await pictures.drop(key);
          return SAVED;
        }
      }
      return failed("card.cards_changed");
    },
    // The order names the cards the page shows (domains/profile `pageCards`, as the page reads them, from the list read
    // on the head the write swaps on), so a hidden card never makes a correct order look stale, and a card another tab
    // added or removed meanwhile fails the check or moves the head; the editor reloads. An incomplete list cannot check
    // an order, so the move is refused; past the cap the member deletes a card first.
    reorder: async (requested) => {
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
        const repo = await readRepo();
        if (!repo.ok) return repo.failed;
        if (repo.list.overflow) return failed("card.overflow");
        if (!repo.list.complete) return failed("card.list_incomplete");
        const stored = repo.profile?.value ?? null;
        const shown = pageCards(owner, stored, repo.list.cards).map((card) => card.key);
        const order = reorderCards(requested, shown);
        if (!order.ok) return failed(order.code);
        const built = withCardOrder(owner, order.order, stored, now());
        if (!built.ok) return failed(built.code);
        const written = await store.write({ profile: profileChange(built.record, repo.profile) }, repo.head);
        if (written.kind !== "ok") return pdsFailure(written);
        if (written.value.kind === "too_large") return failed("profile.too_long");
        if (written.value.kind === "written") return SAVED;
      }
      return failed("card.cards_changed");
    },
    // A profile write, so a refusal reads as one: the profile changed elsewhere, or the PDS did not answer.
    avatarShape: async (shape) => {
      const saved = await store.saveProfile((existing) => withAvatarShape(shape, existing, now()));
      if (saved.kind !== "ok") {
        const failure = pdsFailure(saved);
        return failure.kind === "redirect" ? failure : failed("profile.pds_unavailable");
      }
      if (saved.value.kind === "conflict") return failed("profile.conflict");
      return saved.value.kind === "refused" ? failed(saved.value.code) : SAVED;
    },
  };
}

/** The profile record to write, created when none is stored. */
const profileChange = (record: Readonly<Record<string, unknown>>, stored: StoredRecord | null): ProfileChange => ({
  record,
  exists: stored !== null,
});

type BuiltUpdates = { readonly key: CardKey; readonly record: Readonly<Record<string, unknown>> }[];
type BuiltEdits =
  | { readonly ok: true; readonly updates: BuiltUpdates }
  | { readonly ok: false; readonly failed: CardWrite };

/**
 * The Save's checks before anything is published: each card is still in the list, and at the version its editor
 * opened. Null when they pass; buildEdits makes the same checks again on a retry's fresh list.
 */
function checkEdits(edits: readonly CardEdit[], list: CardList): CardWrite | null {
  const stored = new Map(list.cards.map((card) => [card.key, card]));
  for (const edit of edits) {
    const card = stored.get(edit.key);
    if (card === undefined) return list.complete ? named("card.missing", edit.key) : failed("card.list_incomplete");
    if (card.cid !== edit.version) return named("card.conflict", edit.key);
  }
  return null;
}

/** Each update with the picture of the stored card it swaps on (buildEdits checked each is in the list). */

/**
 * Each edit over its stored card, in order: a card the list does not hold is gone (or, when the list was cut short,
 * cannot be told apart from gone), a stored version other than the editor's is a conflict, and the domain's refusal
 * names the card. The first refusal stops the whole Save.
 */
function buildEdits(edits: readonly CardEdit[], list: CardList, now: string): BuiltEdits {
  const stored = new Map(list.cards.map((card) => [card.key, card]));
  const updates: { key: CardKey; record: Readonly<Record<string, unknown>> }[] = [];
  for (const edit of edits) {
    const card = stored.get(edit.key);
    if (card === undefined) {
      return { ok: false, failed: list.complete ? named("card.missing", edit.key) : failed("card.list_incomplete") };
    }
    if (card.cid !== edit.version) return { ok: false, failed: named("card.conflict", edit.key) };
    const record = toCardRecord(edit.content, edit.width, card.value, now, edit.surface);
    if (!record.ok) return { ok: false, failed: named(record.code, edit.key) };
    updates.push({ key: edit.key, record: record.record });
  }
  return { ok: true, updates };
}

const named = (code: CardFailure, card: CardKey): CardWrite => ({ kind: "failed", code, card });

/** The Save's own keys for the ones the store names, so nothing but a card the member sent is reported back. */
const ofEdits = (edits: readonly CardEdit[], keys: readonly string[]): CardKey[] =>
  edits.map((edit) => edit.key).filter((key) => keys.includes(key));

const tooLarge = (edits: readonly CardEdit[], key: string): CardWrite => {
  const [card] = ofEdits(edits, [key]);
  return card === undefined ? failed("card.save_too_large") : named("card.save_too_large", card);
};

/** The versions the PDS gave the Save's cards, each a CID; any other answer is left out, so its card settles nothing. */
function writtenVersions(edits: readonly CardEdit[], given: SaveManyOutcomeVersions): CardWritten[] {
  return (given ?? []).flatMap(({ key, cid }) => {
    const card = edits.find((edit) => edit.key === key)?.key;
    const version = parseCardVersion(cid);
    return card === undefined || version === null ? [] : [{ key: card, version }];
  });
}
type SaveManyOutcomeVersions = Extract<SaveManyOutcome, { kind: "saved" }>["versions"];

const partly = (edits: readonly CardEdit[], keys: readonly string[]): CardWrite => ({
  kind: "failed",
  code: "card.save_partial",
  saved: ofEdits(edits, keys),
});
