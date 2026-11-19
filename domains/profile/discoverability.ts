// A member's "Search and AI" choices (ADR 0062): may search engines list their public page, may AI search show it,
// and an optional title and description for search results. Both switches are off until the member turns them on.
// The overrides are plain text, one line each, counted in code points as Postgres's char_length counts them, so the
// check here and the table's CHECK (migration 0032) agree.
import type { ProfileError } from "./profile.ts";

export type Discoverability = {
  readonly searchEngines: boolean;
  readonly aiSearch: boolean;
  /** Empty for none: the page uses the member's name. */
  readonly title: string;
  /** Empty for none: the page uses the member's headline. */
  readonly description: string;
};

export const DISCOVERABILITY_OFF: Discoverability = {
  searchEngines: false,
  aiSearch: false,
  title: "",
  description: "",
};

/** The overrides' lengths, the same as the table's CHECK constraints. */
export const DISCOVERABILITY_LIMITS = { title: 70, description: 200 } as const;

export type DiscoverabilityField = "title" | "description";
export type ParsedDiscoverability =
  | { readonly ok: true; readonly value: Discoverability }
  | { readonly ok: false; readonly field: DiscoverabilityField; readonly code: ProfileError };

const FIELDS = ["searchEngines", "aiSearch", "title", "description"] as const;
/** Printable text only: no control characters, so a value stays one line in a header, a tag or robots.txt. */
const CONTROL = /\p{Cc}/u;

function text(raw: string | null, field: DiscoverabilityField) {
  const value = (raw ?? "").trim();
  if (CONTROL.test(value)) return { ok: false, field, code: "profile.invalid" } as const;
  if ([...value].length > DISCOVERABILITY_LIMITS[field]) return { ok: false, field, code: "profile.too_long" } as const;
  return { ok: true, value } as const;
}

/**
 * The settings form: each field at most once, a switch is on only as "on" (an unticked checkbox sends nothing), and
 * any other field name refuses the form.
 */
export function parseDiscoverabilityForm(
  form: URLSearchParams,
): ParsedDiscoverability | { readonly ok: false; readonly code: "profile.invalid" } {
  for (const name of form.keys()) {
    if (!(FIELDS as readonly string[]).includes(name) || form.getAll(name).length > 1)
      return { ok: false, code: "profile.invalid" };
  }
  for (const name of ["searchEngines", "aiSearch"] as const) {
    const value = form.get(name);
    if (value !== null && value !== "on") return { ok: false, code: "profile.invalid" };
  }
  const title = text(form.get("title"), "title");
  if (!title.ok) return title;
  const description = text(form.get("description"), "description");
  if (!description.ok) return description;
  return {
    ok: true,
    value: {
      searchEngines: form.get("searchEngines") === "on",
      aiSearch: form.get("aiSearch") === "on",
      title: title.value,
      description: description.value,
    },
  };
}
