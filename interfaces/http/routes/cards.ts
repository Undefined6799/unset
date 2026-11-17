// The card routes (ADR 0051): the owner creates, edits, deletes and reorders the cards on their page. The kit has
// already checked the method, the media type, the body limit and the CSRF gate, run the server's gate and counted the
// write against the member's own limit (ADR 0045) before a handler reads anything.
// Every write goes to the session's own repo: the DID comes from the session, never the request. A card key from the
// path is parsed by parseCardKey before it reaches the PDS, and a body is read once by domains/profile (DM-1).
// The editor posts JSON in the background and reads the 303 as saved, as the profile island does.
import type { Did } from "@unset/domains-identity";
import { type CardKey, parseCardInput, parseCardKey } from "@unset/domains-profile";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route, type SessionHandler } from "@unset/shared-http";
import type { OpenedApp } from "../app-gate.ts";
import type { CardWrite, CardWrites } from "../card-writes.ts";

const JSON_TYPE = "application/json";
/**
 * The largest card the lexicon allows, as JSON, with room to spare: a collection of 100 entries, each with a 2000-byte
 * address and its text fields at four bytes a grapheme, is under 400 KiB.
 */
export const CARD_BODY_LIMIT_BYTES = 512 * 1024;

export type CardDeps = {
  /** The writes bound to this member's own repo and this request's deadline. */
  writes: (did: Did, deadline: AbortSignal, deadlineAt: number) => CardWrites;
};

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/** The body as one JSON object, or card.invalid. */
async function jsonObject(request: Request): Promise<Readonly<Record<string, unknown>>> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    throw new AppError("card.invalid");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new AppError("card.invalid");
  return body as Readonly<Record<string, unknown>>;
}

/** The path's card key; anything that is not a record key is a missing card, and never reaches the PDS. */
function cardKey(raw: string | undefined): CardKey {
  const key = parseCardKey(raw);
  if (key === null) throw new AppError("http.not_found");
  return key;
}

async function checkedInput(request: Request) {
  const parsed = parseCardInput(await jsonObject(request));
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
    accepts: [JSON_TYPE],
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
    await jsonObject(request);
    const did = opened.session.did;
    return answer(await deps.writes(did, deadline, deadlineAt).remove(key), did);
  }),
  writeRoute("/card-order", async ({ request, deadline, deadlineAt, session: opened }) => {
    const { order } = await jsonObject(request);
    const did = opened.session.did;
    return answer(await deps.writes(did, deadline, deadlineAt).reorder(order), did);
  }),
];
