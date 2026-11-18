// Ported from interfaces/http/card-writes.ts (P1.20i), import path only; that copy goes with P1.20k.
// The card writes behind the card routes (ADR 0051): create, edit, delete and reorder a member's cards on their own
// PDS. Records are built by domains/profile; the PDS calls come from infrastructure/pds through `CardStore`, bound to
// the session's DID in the composition root, so no write here can reach another member's repo.
import {
  type AvatarShape,
  CARDS_MAX,
  type CardContent,
  type CardError,
  type CardKey,
  type CardWidth,
  type ProfileError,
  reorderCards,
  toCardRecord,
  withAvatarShape,
  withCardOrder,
} from "@unset/domains-profile";
import {
  type BuiltRecord,
  type CardList,
  type PdsResult,
  respondToPdsFailure,
  type SaveOutcome,
} from "@unset/infrastructure-pds";
import { shownCards } from "./own-profile.server.ts";

/** The member's own card and profile records, already bound to their DID and this request's deadline. */
export type CardStore = {
  readonly list: () => Promise<PdsResult<CardList>>;
  readonly create: (record: Readonly<Record<string, unknown>>) => Promise<PdsResult<{ readonly key: string }>>;
  readonly save: (
    key: CardKey,
    build: (existing: unknown) => BuiltRecord<CardError>,
  ) => Promise<PdsResult<SaveOutcome<CardError | "card.missing">>>;
  readonly remove: (key: CardKey) => Promise<PdsResult<void>>;
  readonly saveProfile: (
    build: (existing: unknown) => BuiltRecord<ProfileError>,
  ) => Promise<PdsResult<SaveOutcome<ProfileError>>>;
};

export type CardFailure =
  | CardError
  | ProfileError
  | "card.missing"
  | "card.too_many"
  | "card.list_incomplete"
  | "card.conflict"
  | "card.pds_unavailable"
  | "profile.conflict"
  | "profile.pds_unavailable";
export type CardWrite =
  | { readonly kind: "saved" }
  /** `field`, when given, is the form field to blame (the card editor shows the refusal beside it). */
  | { readonly kind: "failed"; readonly code: CardFailure; readonly field?: string }
  /** The PDS grant is gone or lacks a scope; the sign-in pages take over. */
  | { readonly kind: "redirect"; readonly location: string };

export type CardWrites = {
  readonly create: (content: CardContent, width: CardWidth) => Promise<CardWrite>;
  readonly save: (key: CardKey, content: CardContent, width: CardWidth) => Promise<CardWrite>;
  readonly remove: (key: CardKey) => Promise<CardWrite>;
  readonly reorder: (requested: unknown) => Promise<CardWrite>;
  /** The avatar's shape, written into the profile record (sh.unset.profile avatarShape). */
  readonly avatarShape: (shape: AvatarShape) => Promise<CardWrite>;
};

const SAVED: CardWrite = { kind: "saved" };
const failed = (code: CardFailure): CardWrite => ({ kind: "failed", code });

export function cardWrites(store: CardStore, pdsHost: string, now: () => string): CardWrites {
  const pdsFailure = (result: Exclude<PdsResult<unknown>, { kind: "ok" }>): CardWrite => {
    const response = respondToPdsFailure("POST", result, pdsHost);
    return response.action === "redirect"
      ? { kind: "redirect", location: response.location }
      : failed("card.pds_unavailable");
  };
  const outcome = <C extends CardFailure>(result: PdsResult<SaveOutcome<C>>): CardWrite => {
    if (result.kind !== "ok") return pdsFailure(result);
    if (result.value.kind === "conflict") return failed("card.conflict");
    return result.value.kind === "refused" ? failed(result.value.code) : SAVED;
  };

  return {
    // The page reads CARDS_MAX cards, so one past it would be stored and never shown. Counted before the write with no
    // lock (DA-4): two tabs adding at once could both pass and store one more, which the page then leaves out until a
    // card is deleted; a member editing their own page makes that rare, and nothing is lost. A list cut short by the
    // read budget (card-records.ts) is not a count: the add is refused rather than taken as under the cap.
    create: async (content, width) => {
      const built = toCardRecord(content, width, null, now());
      if (!built.ok) return failed(built.code);
      const listed = await store.list();
      if (listed.kind !== "ok") return pdsFailure(listed);
      if (!listed.value.complete) return failed("card.list_incomplete");
      if (listed.value.cards.length >= CARDS_MAX) return failed("card.too_many");
      const created = await store.create(built.record);
      return created.kind === "ok" ? SAVED : pdsFailure(created);
    },
    save: async (key, content, width) =>
      outcome(await store.save(key, (existing) => toCardRecord(content, width, existing, now()))),
    remove: async (key) => {
      const removed = await store.remove(key);
      return removed.kind === "ok" ? SAVED : pdsFailure(removed);
    },
    // The order names the cards the page shows (own-profile.ts reads them the same way), so a hidden card never
    // makes a correct order look stale. A card added in another tab meanwhile fails the check; the editor reloads.
    // An incomplete list cannot check an order, so the move is refused.
    reorder: async (requested) => {
      const listed = await store.list();
      if (listed.kind !== "ok") return pdsFailure(listed);
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
