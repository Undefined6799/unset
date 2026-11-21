// Ported from interfaces/http/own-profile.ts (P1.20i); that copy went with P1.20k.
// The member's own profile and cards for their page (ADR 0051), read from their own PDS. Every record is checked by
// domains/profile on the way in: a bad field reads as unset, a bad card is hidden, a key that is not a record key
// is dropped, and `pageCards` sets the order. Visitors never reach this: public pages wait for the indexer
// (ADR 0052), so there is no live PDS read for anyone but the owner.
import {
  type AvatarShape,
  type Card,
  type CardVersion,
  type ProfileFields,
  pageCards,
  parseCardVersion,
  readAvatarShape,
  readProfileRecord,
} from "@unset/domains-profile";
import type { CardList, PdsResult, StoredRecord } from "@unset/infrastructure-pds";
import { pdsSignInRedirect } from "../../lib/server/pds-failure.ts";

export type OwnProfile =
  | {
      readonly kind: "ok";
      readonly profile: ProfileFields | null;
      /** The avatar's crop; round when unset or unknown. */
      readonly avatarShape: AvatarShape;
      readonly cards: readonly Card[];
      /** Each card's record CID by key, the version its editor opens (ADR 0074); a card without a valid one is absent. */
      readonly versions: ReadonlyMap<string, CardVersion>;
      /** False when the read stopped early (card-records.ts budget): the page says some cards are missing. */
      readonly cardsComplete: boolean;
      /** True when more cards are stored than the page shows: the page asks the member to delete one. */
      readonly cardsOverflow: boolean;
    }
  | { readonly kind: "unavailable" }
  | { readonly kind: "redirect"; readonly location: string };

export type OwnProfileReads = {
  readonly profile: () => Promise<PdsResult<StoredRecord | null>>;
  readonly cards: () => Promise<PdsResult<CardList>>;
};

/**
 * The profile first, then the cards, one after the other on the same session: a failed first read skips the second.
 * Either failing hides the profile, and an ended session sends the member to sign in.
 */
export async function loadOwnProfile(reads: OwnProfileReads): Promise<OwnProfile> {
  const profile = await reads.profile();
  if (profile.kind !== "ok") return failure(profile);
  const cards = await reads.cards();
  if (cards.kind !== "ok") return failure(cards);
  const record = profile.value?.value;
  const fields = record === undefined ? null : readProfileRecord(record);
  return {
    kind: "ok",
    profile: fields === null || fields.displayName === "" ? null : fields,
    avatarShape: readAvatarShape(record),
    cards: pageCards(record, cards.value.cards),
    versions: new Map(
      cards.value.cards.flatMap((stored) => {
        const version = parseCardVersion(stored.cid);
        return version === null ? [] : [[stored.key, version] as const];
      }),
    ),
    cardsComplete: cards.value.complete,
    cardsOverflow: cards.value.overflow,
  };
}

function failure(result: Exclude<PdsResult<unknown>, { kind: "ok" }>): OwnProfile {
  const location = pdsSignInRedirect(result);
  return location === null ? { kind: "unavailable" } : { kind: "redirect", location };
}
