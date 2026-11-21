// Sign-in history (P2.27c, ADR 0082): the times a member signed in, shown to them so they can see what is kept about
// their sign-ins. Only the time: no address, device or browser. Each entry goes 30 days after the sign-in, and the
// member may delete any of them sooner (ADR 0082 point 3). A second check before deleting comes with book P2.28.

declare const signInIdBrand: unique symbol;
/** A sign-in's id, as the store made it: a UUID. */
export type SignInId = string & { readonly [signInIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The page lists this many, newest first; a delete form names at most these. */
export const HISTORY_LIMIT = 50;
/** No sign-in is kept longer than this (Alex 2026-11-21 00:21Z): web's sweep deletes older rows. */
export const SIGN_IN_KEEP_DAYS = 30;

/**
 * The ids a delete form sends: those with a UUID's shape, each once, at most HISTORY_LIMIT (the page lists no more).
 * Anything else is dropped, so a form naming nothing valid deletes nothing (rule DM-1).
 */
export function parseSignInIds(raw: readonly string[]): SignInId[] {
  const ids = new Set<SignInId>();
  for (const value of raw) {
    if (UUID.test(value)) ids.add(value as SignInId);
    if (ids.size === HISTORY_LIMIT) break;
  }
  return [...ids];
}

/** One id a form sends ("Delete all"'s newest listed sign-in), or null when it is not a UUID. */
export const parseSignInId = (raw: string | null): SignInId | null =>
  raw !== null && UUID.test(raw) ? (raw as SignInId) : null;

/** One sign-in. */
export type SignIn = {
  readonly id: SignInId;
  readonly at: Date;
};

/** The store, bound by the caller to the member (rule AB-2: ports are I/O only). */
export type SignInHistory = {
  /** Newest first, at most `limit`. */
  readonly list: (limit: number) => Promise<readonly SignIn[]>;
  /** Deletes those of `ids` that are the member's; says how many went. */
  readonly remove: (ids: readonly SignInId[]) => Promise<number>;
  /** Deletes the member's sign-in `upTo` and every older one; says how many went. */
  readonly removeUpTo: (upTo: SignInId) => Promise<number>;
};
