// The member's own page at /<DID> (P2.13, ADR 0051; P1.20g, P1.20i). Owner-only until public profiles arrive with the
// indexer (ADR 0052): a path that is no DID, or another member's DID, reads as missing (SE-2), and a visitor is sent to
// sign in. The profile and cards come from the member's own PDS. The card writes are this page's form actions: each
// writes only to the session's own repo (the DID is the session's, never the form's), and a card key is parsed before
// it reaches the PDS. A write that succeeds sends the browser back to the page (303); a refusal shows the page again
// with its code and status.
import { type Actions, error, fail, redirect, type ServerLoad } from "@sveltejs/kit";
import { cardViews, websiteLink } from "@unset/apps-web/lib/profile/view";
import { type Did, parseDid } from "@unset/domains-identity";
import { CARD_EDIT_LIMITS, type CardKey, parseCardInput, parseCardKey } from "@unset/domains-profile";
import {
  createCardRecord,
  deleteCardRecord,
  listCardRecords,
  loadProfileRecord,
  saveCardRecord,
  saveProfileRecord,
} from "@unset/infrastructure-pds";
import { AppError, ERROR_MESSAGES } from "@unset/shared-errors";
import { services } from "../../lib/server/compose.ts";
import { config } from "../../lib/server/runtime.ts";
import { accountView } from "./account.server.ts";
import { cardForm } from "./card-form.server.ts";
import { type CardStore, type CardWrite, cardWrites } from "./card-writes.server.ts";
import { loadOwnProfile } from "./own-profile.server.ts";

/**
 * A form body's cap: a README card's 100,000-byte text, percent-encoded at three bytes a byte, its kind and width,
 * with room to spare (interfaces/http/routes/cards.ts). Past it the member is told to shorten the card.
 */
const CARD_FORM_LIMIT_BYTES = 320 * 1024;
/** The fields the order form may send: `order`, once per card. */
const ORDER_FIELD = "order";
const NO_STORE = { "cache-control": "private, no-store", vary: "Cookie" };

/** The page's DID when it is the signed-in member's own; otherwise the request stops here. */
function ownDid(raw: string | undefined, did: string | undefined, method: "GET" | "POST"): Did {
  const page = parseDid(raw ?? "");
  if (page === null) error(404, "http.not_found");
  if (did === undefined) {
    if (method === "POST") error(401, "auth.required"); // the gate refuses it first; kept so no write runs unsigned
    redirect(303, `/login?${new URLSearchParams({ next: `/${page}` })}`);
  }
  if (page !== did) error(404, "http.not_found");
  return page;
}

/** The PDS context of one request: its deadline, and the monotonic time the reads must fit before. */
const pdsContext = (locals: App.Locals) => ({
  memo: new Map(),
  deadline: locals.deadline,
  deadlineAt: locals.deadlineAt,
});

export const load: ServerLoad = async ({ params, locals, setHeaders }) => {
  const did = ownDid(params.did, locals.did, "GET");
  setHeaders(NO_STORE);
  const { pdsCall } = services().pds;
  const ctx = pdsContext(locals);
  const [account, own] = await Promise.all([
    accountView(did, locals.issuerOrigin, locals.deadline),
    loadOwnProfile(
      { profile: () => loadProfileRecord(pdsCall, ctx, did), cards: () => listCardRecords(pdsCall, ctx, did) },
      config.PDS_HOSTNAME,
    ),
  ]);
  if (own.kind === "redirect") redirect(303, own.location);
  const profile = own.kind === "ok" ? own.profile : null;
  const name = profile?.displayName ?? account.handle;
  return {
    account,
    privacyNotice: locals.privacyNotice === true,
    name,
    letter: avatarLetter(name),
    profile:
      profile === null
        ? null
        : { headline: profile.headline, location: profile.location, website: websiteLink(profile.website) },
    cards: own.kind === "ok" ? cardViews(own.cards) : [],
    cardEditLimits: CARD_EDIT_LIMITS,
    cardsIncomplete: own.kind === "ok" && !own.cardsComplete,
    profileUnavailable: own.kind !== "ok",
  };
};

/** The avatar's letter: the name's first character without a leading "@", uppercased; "?" for none (shared/ui). */
function avatarLetter(name: string): string {
  const first = [...name.replace(/^@/, "").trim()][0];
  return first === undefined ? "?" : first.toUpperCase();
}

/** The writes bound to this member's own repo and this request's deadline. */
function writesFor(did: Did, locals: App.Locals) {
  const { pdsCall } = services().pds;
  const ctx = pdsContext(locals);
  const store: CardStore = {
    list: () => listCardRecords(pdsCall, ctx, did),
    create: (record) => createCardRecord(pdsCall, ctx, did, record),
    save: (key, build) => saveCardRecord(pdsCall, ctx, did, key, build),
    remove: (key) => deleteCardRecord(pdsCall, ctx, did, key),
    saveProfile: (build) => saveProfileRecord(pdsCall, ctx, did, build),
  };
  return cardWrites(store, config.PDS_HOSTNAME, () => new Date().toISOString());
}

/** The body as URL-encoded form text within the card cap, or card.form_too_large. */
async function formText(request: Request): Promise<URLSearchParams> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") throw new AppError("card.invalid");
  const text = await request.text();
  if (Buffer.byteLength(text) > CARD_FORM_LIMIT_BYTES) throw new AppError("card.form_too_large");
  return new URLSearchParams(text);
}

/** The `key` field, once, as a record key; anything else is a missing card and never reaches the PDS. */
function keyField(form: URLSearchParams): CardKey {
  const keys = form.getAll("key");
  const key = keys.length === 1 ? parseCardKey(keys[0]) : null;
  if (key === null) throw new AppError("http.not_found");
  form.delete("key");
  return key;
}

/** A card form's content and width, checked by domains/profile (DM-1). */
function cardInput(form: URLSearchParams) {
  const parsed = parseCardInput(cardForm(form));
  if (!parsed.ok) throw new AppError(parsed.code);
  return parsed;
}

/** Only the named fields, each as the forms send it; anything else is card.invalid. */
function onlyFields(form: URLSearchParams, allowed: readonly string[]): void {
  for (const name of form.keys()) if (!allowed.includes(name)) throw new AppError("card.invalid");
}

type ShownCode = keyof typeof ERROR_MESSAGES;
const isShown = (code: string): code is ShownCode => Object.hasOwn(ERROR_MESSAGES, code);

/** A refusal: the page again, with the code's status and its message for the member. */
function refused(code: ShownCode) {
  return fail(new AppError(code).status, { code, message: ERROR_MESSAGES[code] });
}

/**
 * One card write for the signed-in owner: the DID from the session, the body read once, then the write. Saved goes
 * back to the page; a refusal shows the page with its code; a dead grant goes to sign in.
 */
async function write(
  { params, locals, request }: { params: Partial<Record<string, string>>; locals: App.Locals; request: Request },
  run: (form: URLSearchParams, did: Did) => Promise<CardWrite>,
) {
  const did = ownDid(params.did, locals.did, "POST");
  let written: CardWrite;
  try {
    written = await run(await formText(request), did);
  } catch (cause) {
    if (!(cause instanceof AppError) || !isShown(cause.code)) throw cause;
    return refused(cause.code);
  }
  if (written.kind === "redirect") redirect(303, written.location);
  if (written.kind === "failed") return refused(written.code);
  redirect(303, `/${did}`);
}

export const actions: Actions = {
  create: (event) =>
    write(event, (form, did) => {
      const { content, width } = cardInput(form);
      return writesFor(did, event.locals).create(content, width);
    }),
  save: (event) =>
    write(event, (form, did) => {
      const key = keyField(form);
      const { content, width } = cardInput(form);
      return writesFor(did, event.locals).save(key, content, width);
    }),
  remove: (event) =>
    write(event, (form, did) => {
      const key = keyField(form);
      onlyFields(form, []);
      return writesFor(did, event.locals).remove(key);
    }),
  reorder: (event) =>
    write(event, (form, did) => {
      onlyFields(form, [ORDER_FIELD]);
      return writesFor(did, event.locals).reorder(form.has(ORDER_FIELD) ? form.getAll(ORDER_FIELD) : undefined);
    }),
};
