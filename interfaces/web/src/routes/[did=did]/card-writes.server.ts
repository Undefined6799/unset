// Ported from interfaces/http/card-writes.ts (P1.20i), import path only; that copy went with P1.20k.
// The card writes behind the card routes (ADR 0051): create, edit, delete and reorder a member's cards on their own
// PDS. Records are built by domains/profile; the PDS calls come from infrastructure/pds through `CardStore`, bound to
// the session's DID in the composition root, so no write here can reach another member's repo.
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
  type ProfileError,
  reorderCards,
  shownCards,
  toCardRecord,
  withAvatarShape,
  withCardOrder,
} from "@unset/domains-profile";
import type {
  BuiltRecord,
  CardList,
  CreateOutcome,
  PdsResult,
  SaveManyOutcome,
  SaveOutcome,
  UploadedBlob,
} from "@unset/infrastructure-pds";
import { pdsSignInRedirect } from "../../lib/server/pds-failure.ts";

/** The member's own card and profile records, already bound to their DID and this request's deadline. */
export type CardStore = {
  readonly list: () => Promise<PdsResult<CardList>>;
  /** The CID of the repo's head commit, read before a count the create depends on. */
  readonly head: () => Promise<PdsResult<string>>;
  /** A record key for a card web names before writing it (a TID, as the PDS picks). */
  readonly newKey: () => CardKey;
  /** Creates the card only if the repo's head is still `swapCommit`; under `key`, or one the PDS picks. */
  readonly create: (
    record: Readonly<Record<string, unknown>>,
    swapCommit: string,
    key?: CardKey,
  ) => Promise<PdsResult<CreateOutcome>>;
  readonly save: (
    key: CardKey,
    build: (existing: unknown) => BuiltRecord<CardError>,
  ) => Promise<PdsResult<SaveOutcome<CardError | "card.missing">>>;
  readonly remove: (key: CardKey) => Promise<PdsResult<void>>;
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
 * A picture card's publish step (ADR 0070 point 5), bound to the member, their card records' URIs and the request's
 * deadline in the composition root: a use of one of their own uploads, its main version from our store, and the
 * upload to their PDS. Each use is its own short transaction, never around a network call (DA-4).
 */
export type PictureStore = {
  /** Records the card's use of the draft, once however often asked; its pixel size, or null when it is not theirs. */
  readonly use: (id: DraftImageId, key: CardKey) => Promise<{ readonly width: number; readonly height: number } | null>;
  /** Takes back a use whose write did not land. */
  readonly release: (id: DraftImageId, key: CardKey) => Promise<void>;
  readonly main: (
    id: DraftImageId,
  ) => Promise<{ readonly kind: "ok"; readonly bytes: Uint8Array } | { readonly kind: "missing" | "unavailable" }>;
  readonly upload: (bytes: Uint8Array) => Promise<PdsResult<UploadedBlob>>;
  /** The card's record now uses only `keep` (null: no picture); any other picture's use goes. */
  readonly keepOnly: (key: CardKey, keep: DraftImageId | null) => Promise<void>;
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
  | "profile.conflict"
  | "profile.pds_unavailable";
export type CardWrite =
  | { readonly kind: "saved" }
  /**
   * `field`, when given, is the form field to blame (the card editor shows the refusal beside it); `card`, in a save
   * of several cards, is the card it is about; `saved`, in a Save written only in part, are the cards that were.
   */
  | {
      readonly kind: "failed";
      readonly code: CardFailure;
      readonly field?: string;
      readonly card?: CardKey;
      readonly saved?: readonly CardKey[];
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
  readonly create: (content: CardContent, width: CardWidth, surface?: CardSurface) => Promise<CardWrite>;
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
/** A stored record of a picture card, so a save of another kind over it drops its picture's use. */
const isStoredPicture = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as { content?: { $type?: unknown } }).content?.$type === "sh.unset.section#image";

/** A use this write recorded and must settle: kept when its card was written, released when not. */
type Held = { readonly key: CardKey; readonly id: DraftImageId };

export function cardWrites(store: CardStore, now: () => string, pictures: PictureStore): CardWrites {
  const pdsFailure = (result: Exclude<PdsResult<unknown>, { kind: "ok" }>): CardWrite => {
    const location = pdsSignInRedirect(result);
    return location === null ? failed("card.pds_unavailable") : { kind: "redirect", location };
  };

  /**
   * A new picture made publishable, in order: the use first (so no sweep can take the upload mid-save, and the size
   * is the member's own row), then its main version, then the upload to their PDS. Any later failure takes the use
   * back. A card with no new picture passes unchanged.
   */
  const publish = async (
    content: CardContent,
    key: CardKey,
  ): Promise<{ ok: true; content: CardContent; held: Held | null } | { ok: false; failed: CardWrite }> => {
    const id = draftOf(content);
    if (id === null) return { ok: true, content, held: null };
    const size = await pictures.use(id, key);
    if (size === null) return { ok: false, failed: failed("card.image_missing", "image") };
    const main = await pictures.main(id);
    if (main.kind !== "ok") {
      await pictures.release(id, key);
      const code = main.kind === "missing" ? "card.image_missing" : "card.image_unavailable";
      return { ok: false, failed: failed(code, "image") };
    }
    const blob = await pictures.upload(main.bytes);
    if (blob.kind !== "ok") {
      await pictures.release(id, key);
      return { ok: false, failed: pdsFailure(blob) };
    }
    const published: PictureContent = {
      ...(content as PictureContent),
      picture: { kind: "published", blob: blob.value, width: size.width, height: size.height },
    };
    return { ok: true, content: published, held: { key, id } };
  };

  /** Each edit with its new picture published, in order; `held` gains each use. The first refusal stops the Save. */
  const publishAll = async (
    edits: readonly CardEdit[],
    held: Held[],
  ): Promise<{ ok: true; edits: CardEdit[] } | { ok: false; failed: CardWrite }> => {
    const out: CardEdit[] = [];
    for (const edit of edits) {
      const published = await publish(edit.content, edit.key);
      if (!published.ok) {
        const refusal = published.failed;
        return { ok: false, failed: refusal.kind === "failed" ? { ...refusal, card: edit.key } : refusal };
      }
      if (published.held !== null) held.push(published.held);
      out.push({ ...edit, content: published.content });
    }
    return { ok: true, edits: out };
  };

  /**
   * After the write: each held use whose card landed keeps only its new picture, the rest are taken back, and a
   * picture card written over as another kind (`dropped`) loses its picture's use.
   */
  const settle = async (
    result: CardWrite,
    held: readonly Held[],
    written: readonly CardKey[],
    dropped: readonly CardKey[] = [],
  ): Promise<CardWrite> => {
    for (const use of held) {
      if (written.includes(use.key)) await pictures.keepOnly(use.key, use.id);
      else await pictures.release(use.id, use.key);
    }
    for (const key of dropped) if (written.includes(key)) await pictures.keepOnly(key, null);
    return result;
  };
  const outcome = <C extends CardFailure>(result: PdsResult<SaveOutcome<C>>): CardWrite => {
    if (result.kind !== "ok") return pdsFailure(result);
    if (result.value.kind === "conflict") return failed("card.conflict");
    return result.value.kind === "refused" ? failed(result.value.code) : SAVED;
  };

  return {
    // The page reads CARDS_MAX cards, so one past it would be stored and never shown. The count and the create are tied
    // to one repo state (DA-4: compare-and-swap at the PDS): the head is read first, and the create swaps on it, so
    // a card added elsewhere meanwhile (another tab) makes the PDS refuse it and nothing is written. Counted once more
    // then, since an unrelated write to the repo also moves the head; a second refusal asks the member to save again.
    // A list cut short by the read budget (card-records.ts) is not a count: the add is refused.
    // A new picture is published once, after the first count passes, under a key web picks so its use is recorded
    // before the write; a retry reuses it.
    create: async (content, width, surface) => {
      const early = draftOf(content) === null ? toCardRecord(content, width, null, now(), surface) : null;
      if (early !== null && !early.ok) return failed(early.code, early.field);
      let record = early?.record ?? null;
      let held: Held | null = null;
      const done = (result: CardWrite, written: boolean) =>
        settle(result, held === null ? [] : [held], written && held !== null ? [held.key] : []);
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
        const head = await store.head();
        if (head.kind !== "ok") return done(pdsFailure(head), false);
        const listed = await store.list();
        if (listed.kind !== "ok") return done(pdsFailure(listed), false);
        if (listed.value.overflow || listed.value.cards.length >= CARDS_MAX)
          return done(failed("card.too_many"), false);
        if (!listed.value.complete) return done(failed("card.list_incomplete"), false);
        if (record === null) {
          const published = await publish(content, store.newKey());
          if (!published.ok) return published.failed;
          held = published.held;
          const built = toCardRecord(published.content, width, null, now(), surface);
          if (!built.ok) return done(failed(built.code, built.field), false);
          record = built.record;
        }
        const created = await store.create(record, head.value, held?.key);
        if (created.kind !== "ok") return done(pdsFailure(created), false);
        if (created.value.kind === "created") return done(SAVED, true);
      }
      return done(failed("card.cards_changed"), false);
    },
    save: async (key, content, width, surface) => {
      const published = await publish(content, key);
      if (!published.ok) return published.failed;
      let wasPicture = false;
      const result = outcome(
        await store.save(key, (existing) => {
          wasPicture = isStoredPicture(existing);
          return toCardRecord(published.content, width, existing, now(), surface);
        }),
      );
      const held = published.held === null ? [] : [published.held];
      const dropped = wasPicture && content.kind !== "image" ? [key] : [];
      return settle(result, held, result.kind === "saved" ? [key] : [], dropped);
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
      let dropped: CardKey[] = [];
      const done = (result: CardWrite, written: readonly CardKey[]) => settle(result, held, written, dropped);
      const all = edits.map((edit) => edit.key);
      for (let attempt = 0; attempt < SAVE_ALL_ATTEMPTS; attempt += 1) {
        const head = await store.head();
        if (head.kind !== "ok") return done(pdsFailure(head), []);
        const listed = await store.list();
        if (listed.kind !== "ok") return done(pdsFailure(listed), []);
        const checked = checkEdits(edits, listed.value);
        if (checked !== null) return done(checked, []);
        if (ready === null) {
          const published = await publishAll(edits, held);
          if (!published.ok) return done(published.failed, []);
          ready = published.edits;
        }
        dropped = droppedPictures(ready, listed.value);
        const built = buildEdits(ready, listed.value, now());
        if (!built.ok) return done(built.failed, []);
        const saved = await store.saveMany(built.updates, head.value);
        if (saved.kind !== "ok") return done(pdsFailure(saved), []);
        if (saved.value.kind === "saved") return done(SAVED, all);
        if (saved.value.kind === "too_large") return done(tooLarge(edits, saved.value.key), []);
        if (saved.value.kind === "partial")
          return done(partly(edits, saved.value.saved), ofEdits(edits, saved.value.saved));
      }
      return done(failed("card.cards_changed"), []);
    },
    // A deleted card's record uses no picture any more; their copies go a week later.
    remove: async (key) => {
      const removed = await store.remove(key);
      if (removed.kind !== "ok") return pdsFailure(removed);
      await pictures.keepOnly(key, null);
      return SAVED;
    },
    // The order names the cards the page shows (domains/profile `shownCards`, as the page reads them), so a hidden card never
    // makes a correct order look stale. A card added in another tab meanwhile fails the check; the editor reloads.
    // An incomplete list cannot check an order, so the move is refused; past the cap the member deletes a card first.
    reorder: async (requested) => {
      const listed = await store.list();
      if (listed.kind !== "ok") return pdsFailure(listed);
      if (listed.value.overflow) return failed("card.overflow");
      if (!listed.value.complete) return failed("card.list_incomplete");
      const order = reorderCards(
        requested,
        shownCards(listed.value.cards).map((card) => card.key),
      );
      if (!order.ok) return failed(order.code);
      return outcome(await store.saveProfile((existing) => withCardOrder(order.order, existing, now())));
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

type BuiltEdits =
  | {
      readonly ok: true;
      readonly updates: { readonly key: CardKey; readonly record: Readonly<Record<string, unknown>> }[];
    }
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

/** Stored picture cards this Save writes as another kind. */
function droppedPictures(edits: readonly CardEdit[], list: CardList): CardKey[] {
  const stored = new Map(list.cards.map((card) => [card.key, card.value]));
  return edits
    .filter((edit) => edit.content.kind !== "image" && isStoredPicture(stored.get(edit.key)))
    .map((edit) => edit.key);
}

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

const partly = (edits: readonly CardEdit[], keys: readonly string[]): CardWrite => ({
  kind: "failed",
  code: "card.save_partial",
  saved: ofEdits(edits, keys),
});
