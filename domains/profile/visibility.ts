// Who a member's page is shown to (ADR 0078; Alex, 2026-11-20 19:43Z and 19:45Z): everyone, people signed in to
// unset.sh, or only the member. The choice is the profile record's `visibility` field, so it travels with the member's
// record. It asks apps not to show the page; it is not access control: the record stays readable by anyone on the
// network, which the settings say beside the choice. Absent means public; a value we do not know reads as the most
// closed one, so a newer client's choice is never shown more widely than its owner meant.

export type ProfileVisibility = "public" | "signedIn" | "ownerOnly";
export const PROFILE_VISIBILITIES: readonly ProfileVisibility[] = ["public", "signedIn", "ownerOnly"];
/** Each choice as the record stores it: the lexicon's kebab-case known values (ADR 0086). */
export const VISIBILITY_VALUES: Readonly<Record<ProfileVisibility, string>> = {
  public: "public",
  signedIn: "signed-in",
  ownerOnly: "owner-only",
};

/** A save's choice, or null when it is not one we know (DM-1): a save writes only known values. */
export function parseProfileVisibility(input: unknown): ProfileVisibility | null {
  return PROFILE_VISIBILITIES.find((visibility) => visibility === input) ?? null;
}

/** The stored choice: absent means public; anything else we do not know means only the member (fail closed). */
export function readProfileVisibility(record: unknown): ProfileVisibility {
  const stored =
    typeof record === "object" && record !== null && !Array.isArray(record)
      ? (record as Readonly<Record<string, unknown>>).visibility
      : undefined;
  if (stored === undefined) return "public";
  return PROFILE_VISIBILITIES.find((visibility) => VISIBILITY_VALUES[visibility] === stored) ?? "ownerOnly";
}

/** Who is looking: the page's own member, another signed-in member, or someone not signed in. */
export type Viewer = "owner" | "member" | "visitor";

/**
 * What the viewer is shown. `page` is the whole page; `crawlable` is false unless it is public, so a page not shown to
 * everyone is never offered to search engines or AI search, whatever the member's Search and AI choices say. `limited`
 * is the small page that says the member exists and shows only their name and handle (Alex, 19:46Z); `signIn` when
 * signing in would show the page.
 */
export type PageShown =
  | { readonly kind: "page"; readonly crawlable: boolean }
  | { readonly kind: "limited"; readonly signIn: boolean };

export function pageShownTo(visibility: ProfileVisibility, viewer: Viewer): PageShown {
  if (visibility === "public") return { kind: "page", crawlable: true };
  if (viewer === "owner") return { kind: "page", crawlable: false };
  if (visibility === "signedIn" && viewer === "member") return { kind: "page", crawlable: false };
  return { kind: "limited", signIn: visibility === "signedIn" };
}
