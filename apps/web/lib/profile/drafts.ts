// A Text card's unsaved words, kept on the member's own device only (ADR 0074 item 4): in the browser's localStorage,
// under a key that is a SHA-256 of the DID and the card's key, with the record version the edit started from. Nothing
// here reaches the server. The page offers a draft back when it opens and never merges it on its own; sign-out's
// `Clear-Site-Data: "storage"` removes every draft on the device. A device that refuses to store (storage full or
// turned off, https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-setitem) keeps no draft: the words
// stay in the page until it closes, as they would with no drafts at all.

/** The part of the Web Storage API drafts use, so tests can hand in their own. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type Draft = { readonly version: string; readonly text: string };

const PREFIX = "unset.draft.";
const FORMAT = 1;

/**
 * The storage key of each member's card once worked out, so a later write needs no wait for the digest: it lands before
 * writeDraft returns, in the order the writes were made, even when the page goes away right after.
 */
const known = new Map<string, string>();

function storageKey(did: string, card: string): string | Promise<string> {
  const name = `${did}\n${card}`;
  const cached = known.get(name);
  if (cached !== undefined) return cached;
  return digestKey(name);
}

async function digestKey(name: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name)));
  const key = PREFIX + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  known.set(name, key);
  return key;
}

/** Keeps the draft; false when the device would not store it. */
export async function writeDraft(storage: DraftStorage, did: string, card: string, draft: Draft): Promise<boolean> {
  const found = storageKey(did, card);
  const key = typeof found === "string" ? found : await found;
  try {
    storage.setItem(key, JSON.stringify({ v: FORMAT, version: draft.version, text: draft.text }));
    return true;
  } catch {
    return false;
  }
}

/** The draft for this member's card, or null: none, one the device will not give back, or one not in our shape. */
export async function readDraft(storage: DraftStorage, did: string, card: string): Promise<Draft | null> {
  const key = await storageKey(did, card);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const draft = parseDraft(raw);
  if (draft === null) forget(storage, key);
  return draft;
}

export async function clearDraft(storage: DraftStorage, did: string, card: string): Promise<void> {
  const found = storageKey(did, card);
  forget(storage, typeof found === "string" ? found : await found);
}

function parseDraft(raw: string): Draft | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { v, version, text } = value as Record<string, unknown>;
  if (v !== FORMAT || typeof version !== "string" || typeof text !== "string") return null;
  return { version, text };
}

function forget(storage: DraftStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage turned off: there is nothing it could hold to remove.
  }
}
