// The member's own page at /<DID> (P2.13, ADR 0051; P1.20g, P1.20i; the avatar's shape, P1.20k). Owner-only: a path
// that is no DID reads as missing (SE-2), and anyone but the owner is sent to the public page at /@<DID> (P3.12s).
// The profile and cards come from the member's own PDS. The card writes are this page's form actions: each writes only
// to the session's own repo (the DID is the session's, never the form's), and a card key is parsed before it reaches
// the PDS. A write that succeeds sends the browser back to the page (303); a refusal shows the page again with its
// code and status.
import { type Actions, error, fail, redirect, type ServerLoad } from "@sveltejs/kit";
import type { CardPanelRequest, CardView } from "@unset/apps-web/lib/profile/types.ts";
import { cardViews, contactAction, websiteLink } from "@unset/apps-web/lib/profile/view.ts";
import { type Did, parseDid } from "@unset/domains-identity";
import {
  CARD_EDIT_LIMITS,
  type CardKey,
  parseAvatarShape,
  parseCardInput,
  parseCardKey,
  parseCardVersion,
} from "@unset/domains-profile";
import {
  createCardRecord,
  deleteCardRecord,
  latestCommit,
  listCardRecords,
  loadProfileRecord,
  newCardKey,
  saveCardRecord,
  saveCardRecords,
  saveProfileRecord,
  uploadImageBlob,
} from "@unset/infrastructure-pds";
import { AppError, ERROR_MESSAGES } from "@unset/shared-errors";
import { LIMITS } from "@unset/shared-lexicons";
import { accountView } from "../../lib/server/account.ts";
import { services } from "../../lib/server/compose.ts";
import { themeFromCookies, themeReturnTo } from "../../lib/server/theme.ts";
import type { ShellData } from "../../lib/shell.ts";
import { readCardForm, splitCardsForm } from "./card-form.server.ts";
import { type CardEdit, type CardStore, type CardWrite, cardWrites } from "./card-writes.server.ts";
import { loadOwnProfile } from "./own-profile.server.ts";
import { picturesFor } from "./picture-store.server.ts";
import { CARD_FORM_LIMIT_BYTES } from "./policy.ts";
import { partialMessage } from "./save-message.server.ts";

/** The fields the order form may send: `order`, once per card. */
const ORDER_FIELD = "order";
/** The avatar form's one field. */
const SHAPE_FIELD = "avatarShape";

/**
 * The page's DID when it is the signed-in member's own; otherwise the request stops here. Anyone else who opens it,
 * signed out or another member, is sent to the DID's public page (P3.12s), so the link a member copies from here works
 * for everyone. That page answers an unknown, hidden or erased DID with the same 404, so the redirect, made for every
 * DID alike, says nothing about the account (SE-2). A write never redirects: it stops unsigned or as missing.
 */
function ownDid(raw: string | undefined, did: string | undefined, method: "GET" | "POST"): Did {
  const page = parseDid(raw ?? "");
  if (page === null) error(404, "http.not_found");
  if (page === did) return page;
  if (method === "GET") redirect(303, `/@${page}`);
  if (did === undefined) error(401, "auth.required"); // the gate sends it to sign in first; kept so no write runs unsigned
  error(404, "http.not_found");
}

/** The PDS context of one request: its deadline, and the monotonic time the reads must fit before. */
const pdsContext = (locals: App.Locals) => ({
  memo: new Map(),
  deadline: locals.deadline,
  deadlineAt: locals.deadlineAt,
});

const PANEL_KINDS = ["readme", "links", "collection", "buttons"] as const;

/**
 * The editor the page opens in place, from its query (apps/web/lib/profile/panel.ts): a card's editor or delete
 * confirm for a card the page shows, the Add card picker or a kind's editor, or the avatar's shape. Anything else, or
 * no profile to edit yet, opens none.
 */
function cardPanel(query: URLSearchParams, cards: readonly CardView[], editable: boolean): CardPanelRequest | null {
  if (!editable) return null;
  const shown = (key: string | null) => (key !== null && cards.some((card) => card.key === key) ? key : null);
  const edit = shown(query.get("edit"));
  if (edit !== null) return { kind: "edit", key: edit };
  const remove = shown(query.get("remove"));
  if (remove !== null) return { kind: "remove", key: remove };
  const add = query.get("add");
  if (add !== null) return { kind: "add", card: PANEL_KINDS.find((kind) => kind === add) ?? null };
  return query.has("avatar") ? { kind: "avatar" } : null;
}

export const load: ServerLoad = async ({ params, locals, request, url }) => {
  const did = ownDid(params.did, locals.did, "GET");
  const { pdsCall } = services().pds;
  const ctx = pdsContext(locals);
  const [account, own] = await Promise.all([
    accountView(services(), did, locals.issuerOrigin, locals.deadline),
    loadOwnProfile({
      profile: () => loadProfileRecord(pdsCall, ctx, did),
      cards: () => listCardRecords(pdsCall, ctx, did),
    }),
  ]);
  if (own.kind === "redirect") redirect(303, own.location);
  const profile = own.kind === "ok" ? own.profile : null;
  const name = profile?.displayName ?? account.handle;
  const path = `/${did}`;
  const shell: ShellData = {
    kind: "core",
    active: "account",
    account: account.verified ? { path, name: account.handle } : { path },
    prefs: { theme: themeFromCookies(request.headers.get("cookie")), returnTo: themeReturnTo(path) },
    noindex: true,
    wide: true,
  };
  const cards = own.kind === "ok" ? cardViews(own.cards, own.versions) : [];
  return {
    shell,
    account,
    name,
    letter: avatarLetter(name),
    profile:
      profile === null
        ? null
        : { headline: profile.headline, location: profile.location, website: websiteLink(profile.website) },
    avatarShape: own.kind === "ok" ? own.avatarShape : "round",
    cards,
    contact: contactAction(cards),
    cardPanel: cardPanel(url.searchParams, cards, profile !== null),
    cardEditLimits: { ...CARD_EDIT_LIMITS, text: LIMITS.section.textBytes, formBytes: CARD_FORM_LIMIT_BYTES },
    cardsIncomplete: own.kind === "ok" && !own.cardsComplete && !own.cardsOverflow,
    cardsOverflow: own.kind === "ok" && own.cardsOverflow,
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
    head: () => latestCommit(pdsCall, ctx, did),
    newKey: () => newCardKey() as CardKey,
    create: (record, swapCommit, key) => createCardRecord(pdsCall, ctx, did, record, swapCommit, key),
    save: (key, build) => saveCardRecord(pdsCall, ctx, did, key, build),
    remove: (key) => deleteCardRecord(pdsCall, ctx, did, key),
    saveMany: (updates, swapCommit) => saveCardRecords(pdsCall, ctx, did, updates, swapCommit),
    saveProfile: (build) => saveProfileRecord(pdsCall, ctx, did, build),
  };
  const { images, drafts, pds } = services();
  const upload = (bytes: Uint8Array) => uploadImageBlob(pds.pdsCall, ctx, did, bytes);
  return cardWrites(
    store,
    () => new Date().toISOString(),
    picturesFor(did, { images, drafts, upload }, locals.deadline),
  );
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

/**
 * A card form's content and width, checked by domains/profile (DM-1); a refusal names the form's field to blame when
 * the domain names one, so the editor can show it there.
 */
function cardInput(form: URLSearchParams) {
  const { body, fieldName } = readCardForm(form);
  const parsed = parseCardInput(body);
  if (parsed.ok) return parsed;
  const field = parsed.field === undefined ? undefined : fieldName(parsed.field);
  const failed: CardWrite =
    field === undefined ? { kind: "failed", code: parsed.code } : { kind: "failed", code: parsed.code, field };
  return { ok: false, failed } as const;
}

/**
 * The one Save's cards (ADR 0074): each card's `key` and `version` once, then its fields read as one card form, so a
 * refusal names the card and the field in the Save's own names (`cards.N.text`). A card named twice, or with no
 * version, is card.invalid before anything is read from the PDS.
 */
function cardEdits(form: URLSearchParams):
  | { readonly ok: true; readonly edits: CardEdit[] }
  | {
      readonly ok: false;
      readonly failed: CardWrite;
    } {
  const edits: CardEdit[] = [];
  for (const { index, form: card } of splitCardsForm(form)) {
    const keys = card.getAll("key");
    const versions = card.getAll("version");
    const key = keys.length === 1 ? parseCardKey(keys[0]) : null;
    const version = versions.length === 1 ? parseCardVersion(versions[0]) : null;
    if (key === null || version === null || edits.some((edit) => edit.key === key)) throw new AppError("card.invalid");
    card.delete("key");
    card.delete("version");
    const input = cardInput(card);
    if (!input.ok) return { ok: false, failed: inSave(input.failed, index, key) };
    const { content, width, surface } = input;
    edits.push(surface === undefined ? { key, version, content, width } : { key, version, content, width, surface });
  }
  return { ok: true, edits };
}

/** A card form's refusal as the Save names it: the card, and its field under that card's prefix. */
function inSave(failed: CardWrite, index: number, card: CardKey): CardWrite {
  if (failed.kind !== "failed") return failed;
  return failed.field === undefined
    ? { kind: "failed", code: failed.code, card }
    : { kind: "failed", code: failed.code, card, field: `cards.${index}.${failed.field}` };
}

/** Only the named fields, each as the forms send it; anything else is card.invalid. */
function onlyFields(form: URLSearchParams, allowed: readonly string[]): void {
  for (const name of form.keys()) if (!allowed.includes(name)) throw new AppError("card.invalid");
}

type ShownCode = keyof typeof ERROR_MESSAGES;
const isShown = (code: string): code is ShownCode => Object.hasOwn(ERROR_MESSAGES, code);

/**
 * A refusal: the page again, with the code's status, its message for the member, the field to blame if one is, and
 * for a card form what was typed, so an editor drawn in place with no script shows it again (card-panel.svelte).
 */
function refused(
  code: ShownCode,
  shown: {
    readonly field?: string | undefined;
    readonly values?: Record<string, string> | undefined;
    readonly card?: string | undefined;
    readonly saved?: readonly string[] | undefined;
    readonly message?: string | undefined;
  } = {},
) {
  const { field, values, card, saved, message } = shown;
  return fail(new AppError(code).status, {
    code,
    message: message ?? ERROR_MESSAGES[code],
    ...(field === undefined ? {} : { field }),
    ...(card === undefined ? {} : { card }),
    ...(saved === undefined ? {} : { saved }),
    ...(values === undefined ? {} : { values }),
  });
}

/**
 * One card write for the signed-in owner: the DID from the session, the body read once, then the write. Saved goes
 * back to the page; a refusal shows the page with its code; a dead grant goes to sign in.
 */
async function write(
  { params, locals, request }: { params: Partial<Record<string, string>>; locals: App.Locals; request: Request },
  run: (form: URLSearchParams, did: Did) => CardWrite | Promise<CardWrite>,
  echo = false,
  explain: (written: Extract<CardWrite, { kind: "failed" }>) => string | undefined = () => undefined,
) {
  const did = ownDid(params.did, locals.did, "POST");
  let written: CardWrite;
  let typed: Record<string, string> | undefined;
  try {
    const form = await formText(request);
    if (echo) typed = Object.fromEntries(form);
    written = await run(form, did);
  } catch (cause) {
    if (!(cause instanceof AppError) || !isShown(cause.code)) throw cause;
    return refused(cause.code, { values: typed });
  }
  if (written.kind === "redirect") redirect(303, written.location);
  if (written.kind === "failed") {
    const { code, field, card, saved } = written;
    return refused(code, { field, values: typed, card, saved, message: explain(written) });
  }
  redirect(303, `/${did}`);
}

export const actions: Actions = {
  create: (event) =>
    write(
      event,
      (form, did) => {
        const input = cardInput(form);
        return input.ok ? writesFor(did, event.locals).create(input.content, input.width, input.surface) : input.failed;
      },
      true,
    ),
  save: (event) =>
    write(
      event,
      (form, did) => {
        const key = keyField(form);
        const input = cardInput(form);
        return input.ok
          ? writesFor(did, event.locals).save(key, input.content, input.width, input.surface)
          : input.failed;
      },
      true,
    ),
  // The one Save (ADR 0074): every changed card at once, all or none. Sent by the page's script only, so a refusal is
  // not echoed back for an editor drawn with no script; the cards keep their text in the page.
  saveAll: (event) => {
    let edits: readonly CardEdit[] = [];
    return write(
      event,
      (form, did) => {
        const read = cardEdits(form);
        if (!read.ok) return read.failed;
        edits = read.edits;
        return writesFor(did, event.locals).saveAll(edits);
      },
      false,
      (written) => (written.saved === undefined ? undefined : partialMessage(edits, written.saved)),
    );
  },
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
  avatar: (event) =>
    write(event, (form, did) => {
      const shapes = form.getAll(SHAPE_FIELD);
      const shape = shapes.length === 1 ? parseAvatarShape(shapes[0]) : null;
      if (shape === null || [...form.keys()].some((name) => name !== SHAPE_FIELD)) {
        throw new AppError("profile.invalid");
      }
      return writesFor(did, event.locals).avatarShape(shape);
    }),
};
