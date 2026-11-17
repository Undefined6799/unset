// The card routes (ADR 0051): the owner creates, edits, deletes and reorders the cards on their page. The kit has
// already checked the method, the media type, the body limit and the CSRF gate, run the server's gate and counted the
// write against the member's own limit (ADR 0045) before a handler reads anything.
// Every write goes to the session's own repo: the DID comes from the session, never the request. A card key from the
// path is parsed by parseCardKey before it reaches the PDS, and a body is read once by domains/profile (DM-1).
// The owner's page posts README cards, deletes and moves as plain forms, as Settings › Profile posts POST /profile
// (ADR 0037 point 7): the browser follows the 303 itself and needs no script. The card kinds with lists are posted as
// JSON, since form encoding can triple a full collection past the body limit. Both bodies reach the same parser.
import type { Did } from "@unset/domains-identity";
import { type CardKey, parseCardInput, parseCardKey } from "@unset/domains-profile";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route, type SessionHandler } from "@unset/shared-http";
import type { OpenedApp } from "../app-gate.ts";
import type { CardWrite, CardWrites } from "../card-writes.ts";

const JSON_TYPE = "application/json";
const FORM = "application/x-www-form-urlencoded";
/**
 * The largest card the lexicon allows, as JSON. A collection is the largest: a 1,000-byte title and 100 entries of
 * 4,600 bytes of text (title, tag, description) and a 2,000-byte address. JSON escaping adds at most five bytes a
 * grapheme (a control character becomes \u00XX; addresses need none), so the title is at most 1,500 bytes and an
 * entry 8,900: about 896 KB with the keys, which 1 MiB holds.
 */
export const CARD_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * A form body's cap: a README card's 100,000-byte text, percent-encoded at three bytes a byte, its kind and width,
 * with room to spare. Below CARD_BODY_LIMIT_BYTES, which the kit applies to both media types first.
 */
export const CARD_FORM_LIMIT_BYTES = 320 * 1024;
/** The fields each form may send; anything else, or a field sent twice where one is meant, is card.invalid. */
const CARD_FORM_FIELDS = ["kind", "width", "text"] as const;
const ORDER_FORM_FIELDS = ["order"] as const;

export type CardDeps = {
  /** The writes bound to this member's own repo and this request's deadline. */
  writes: (did: Did, deadline: AbortSignal, deadlineAt: number) => CardWrites;
};

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/** The body as one JSON object, or card.invalid. */
function jsonObject(text: string): Readonly<Record<string, unknown>> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError("card.invalid");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new AppError("card.invalid");
  return body as Readonly<Record<string, unknown>>;
}

/** A form's fields as one object: each allowed field once, except `order`, which is the list of its values. */
function formObject(text: string, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (Buffer.byteLength(text) > CARD_FORM_LIMIT_BYTES) throw new AppError("http.payload_too_large");
  const form = new URLSearchParams(text);
  const body: Record<string, unknown> = {};
  for (const name of new Set(form.keys())) {
    const values = form.getAll(name);
    if (!allowed.includes(name)) throw new AppError("card.invalid");
    if (name === "order") body[name] = values;
    else if (values.length > 1) throw new AppError("card.invalid");
    else body[name] = values[0];
  }
  return body;
}

/** The body as one object, read as the media type the kit already admitted. */
async function bodyObject(request: Request, formFields: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  const text = await request.text();
  return type === FORM ? formObject(text, formFields) : jsonObject(text);
}

/** The path's card key; anything that is not a record key is a missing card, and never reaches the PDS. */
function cardKey(raw: string | undefined): CardKey {
  const key = parseCardKey(raw);
  if (key === null) throw new AppError("http.not_found");
  return key;
}

async function checkedInput(request: Request) {
  const parsed = parseCardInput(await bodyObject(request, CARD_FORM_FIELDS));
  if (!parsed.ok) throw new AppError(parsed.code);
  return parsed;
}

function answer(written: CardWrite, did: Did): Response {
  if (written.kind === "saved") return seeOther(`/${did}`);
  if (written.kind === "redirect") return seeOther(written.location);
  throw new AppError(written.code);
}

/** A card write: same-origin JSON, the member's own write limit, and the session the gate admitted. */
const writeRoute = (path: string, handler: SessionHandler<OpenedApp>): Route =>
  defineRoute<OpenedApp>({
    method: "POST",
    path,
    group: "app",
    accepts: [JSON_TYPE, FORM],
    bodyLimit: CARD_BODY_LIMIT_BYTES,
    rateLimit: "profile",
    mutates: true,
    session: "required",
    handler,
  });

export const cardRoutes = (deps: CardDeps): Route[] => [
  writeRoute("/cards", async ({ request, deadline, deadlineAt, session: opened }) => {
    const { content, width } = await checkedInput(request);
    const did = opened.session.did;
    return answer(await deps.writes(did, deadline, deadlineAt).create(content, width), did);
  }),
  writeRoute("/cards/:key", async ({ request, params, deadline, deadlineAt, session: opened }) => {
    const key = cardKey(params.key);
    const { content, width } = await checkedInput(request);
    const did = opened.session.did;
    return answer(await deps.writes(did, deadline, deadlineAt).save(key, content, width), did);
  }),
  writeRoute("/cards/:key/delete", async ({ request, params, deadline, deadlineAt, session: opened }) => {
    const key = cardKey(params.key);
    await bodyObject(request, []);
    const did = opened.session.did;
    return answer(await deps.writes(did, deadline, deadlineAt).remove(key), did);
  }),
  writeRoute("/card-order", async ({ request, deadline, deadlineAt, session: opened }) => {
    const { order } = await bodyObject(request, ORDER_FORM_FIELDS);
    const did = opened.session.did;
    return answer(await deps.writes(did, deadline, deadlineAt).reorder(order), did);
  }),
];
