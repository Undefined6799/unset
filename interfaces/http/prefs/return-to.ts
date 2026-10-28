// Where the theme form sends the browser back to (P2.13d; architecture's 04:50Z ruling on verify-1066-89624f3 M2).
// Every target goes through the kit's safeReturnPath, which refuses /login so nothing loops through sign-in. The one
// exception is this form's own: a visitor who changes the theme on the sign-in pages lands back on them. Only the two
// exact paths qualify, compared as strings, and their query is rebuilt from `next` (re-checked by safeReturnPath) and
// `handle` (kept only when it is valid handle or DID syntax), never copied. Any other /login-prefixed target goes
// home. shared/http's returnPath and DENIED_TARGETS are not changed.
import { parseDid, parseHandle } from "@unset/domains-identity";
import { safeReturnPath } from "@unset/shared-http";
import { single } from "../form-field.ts";

const SIGN_IN_PATHS: ReadonlySet<string> = new Set(["/login", "/login/continue"]);
const HOME = "/";

/** A handle as parseHandle normalises it, or a DID as written (DIDs are case-sensitive); null for anything else. */
function checkedHandle(raw: string | null): string | null {
  if (raw === null) return null;
  return parseDid(raw) ?? parseHandle(raw);
}

/** A sign-in page with only its checked `next` and `handle`, or home for any other /login-prefixed target. */
function signInReturn(target: string): string {
  if (target.includes("#")) return HOME;
  const mark = target.indexOf("?");
  const path = mark === -1 ? target : target.slice(0, mark);
  if (!SIGN_IN_PATHS.has(path)) return HOME;
  const query = new URLSearchParams(mark === -1 ? "" : target.slice(mark + 1));
  const rebuilt = new URLSearchParams();
  const next = safeReturnPath(single(query, "next"));
  if (next !== null) rebuilt.set("next", next);
  const handle = checkedHandle(single(query, "handle"));
  if (handle !== null) rebuilt.set("handle", handle);
  return rebuilt.size === 0 ? path : `${path}?${rebuilt}`;
}

/** The theme form's return target: a sign-in page as above, otherwise safeReturnPath's answer, or home when that is
 * missing or /login-prefixed. */
export function themeReturnTo(target: string | null): string {
  if (target === null) return HOME;
  if (target.toLowerCase().startsWith("/login")) return signInReturn(target);
  // safeReturnPath resolves dot segments, so /./loginx comes back as /loginx: check its answer too.
  const safe = safeReturnPath(target);
  return safe === null || safe.toLowerCase().startsWith("/login") ? HOME : safe;
}

/** The page's own return target for the footer form: the query only on a sign-in page, where it is rebuilt. */
export const pageReturnTo = (url: URL): string =>
  themeReturnTo(SIGN_IN_PATHS.has(url.pathname) ? url.pathname + url.search : url.pathname);
