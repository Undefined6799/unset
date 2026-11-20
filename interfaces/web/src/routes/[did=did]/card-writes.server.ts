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
} from "@unset/infrastructure-pds";
import { pdsSignInRedirect } from "../../lib/server/pds-failure.ts";

/** The member's own card and profile records, already bound to their DID and this request's deadline. */
export type CardStore = {
  readonly list: () => Promise<PdsResult<CardList>>;
  /** The CID of the repo's head commit, read before a count the create depends on. */
  readonly head: () => Promise<PdsResult<string>>;
  /** Creates the card only if the repo's head is still `swapCommit`. */
  readonly create: (record: Readonly<Record<string, unknown>>, swapCommit: string) => Promise<PdsResult<CreateOutcome>>;
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

export type CardFailure =
  | CardError
  | ProfileError
  | "card.missing"
  | "card.too_many"
  | "card.overflow"
  | "card.cards_changed"
  | "card.list_incomplete"
  | "card.conflict"
  | "card.pds_unavailable"
  | "profile.conflict"
  | "profile.pds_unavailable";
export type CardWrite =
  | { readonly kind: "saved" }
  /**
   * `field`, when given, is the form field to blame (the card editor shows the refusal beside it); `card`, in a save
   * of several cards, is the card it is about.
   */
  | { readonly kind: "failed"; readonly code: CardFailure; readonly field?: string; readonly card?: CardKey }
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
const failed = (code: CardFailure): CardWrite => ({ kind: "failed", code });

export function cardWrites(store: CardStore, now: () => string): CardWrites {
  const pdsFailure = (result: Exclude<PdsResult<unknown>, { kind: "ok" }>): CardWrite => {
    const location = pdsSignInRedirect(result);
    return location === null ? failed("card.pds_unavailable") : { kind: "redirect", location };
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
    create: async (content, width, surface) => {
      const built = toCardRecord(content, width, null, now(), surface);
      if (!built.ok) return failed(built.code);
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
        const head = await store.head();
        if (head.kind !== "ok") return pdsFailure(head);
        const listed = await store.list();
        if (listed.kind !== "ok") return pdsFailure(listed);
        if (listed.value.overflow || listed.value.cards.length >= CARDS_MAX) return failed("card.too_many");
        if (!listed.value.complete) return failed("card.list_incomplete");
        const created = await store.create(built.record, head.value);
        if (created.kind !== "ok") return pdsFailure(created);
        if (created.value.kind === "created") return SAVED;
      }
      return failed("card.cards_changed");
    },
    save: async (key, content, width, surface) =>
      outcome(await store.save(key, (existing) => toCardRecord(content, width, existing, now(), surface))),
    // The versions and the write are tied to one repo state (DA-4: compare-and-swap at the PDS): the head is read
    // first, the list after it, and the write swaps on that head, so a card written elsewhere since either read makes
    // the PDS refuse and nothing is written. Each card must still be the version the member's editor opened; one that
    // is not is refused by name, so their text is never written over another tab's. Any other write to the repo (a
    // like) also moves the head, so it is read once more; a second refusal asks the member to save again.
    saveAll: async (edits) => {
      if (edits.length === 0) return SAVED;
      for (let attempt = 0; attempt < SAVE_ALL_ATTEMPTS; attempt += 1) {
        const head = await store.head();
        if (head.kind !== "ok") return pdsFailure(head);
        const listed = await store.list();
        if (listed.kind !== "ok") return pdsFailure(listed);
        const built = buildEdits(edits, listed.value, now());
        if (!built.ok) return built.failed;
        const saved = await store.saveMany(built.updates, head.value);
        if (saved.kind !== "ok") return pdsFailure(saved);
        if (saved.value.kind === "saved") return SAVED;
      }
      return failed("card.cards_changed");
    },
    remove: async (key) => {
      const removed = await store.remove(key);
      return removed.kind === "ok" ? SAVED : pdsFailure(removed);
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
