// The Message link's lookup (build step 10; ADR 0094 decision 6, ADR 0101 decision 3): a profile on unset.sh links to
// the chat page by the member's DID, and the page asks the door for that member's chat user. Only a browser that holds
// the device it names may ask (rule SE-2: a browser signed in to chat), and the store finds only a member whose chat
// is ready and whose public page shows, so every other member reads as the same missing (D7).
import type { Did } from "@unset/domains-identity";
import type { BrowserKey, BrowserList, DeviceId } from "./browser.ts";
import type { ChatUser } from "./chat-account.ts";

export type ChatContacts = {
  /** The chat user of `did` when their chat is ready and their public page shows; null otherwise. */
  chatUserOf(did: Did, deadline: AbortSignal): Promise<ChatUser | null>;
};

export type ContactOutcome =
  | { readonly kind: "found"; readonly user: ChatUser }
  | { readonly kind: "missing" }
  | { readonly kind: "no_session" };

type Ports = { readonly list: BrowserList; readonly contacts: ChatContacts };
type Request = {
  readonly browser: BrowserKey;
  readonly device: DeviceId;
  readonly did: Did;
  readonly deadline: AbortSignal;
};

export async function chatContact(ports: Ports, { browser, device, did, deadline }: Request): Promise<ContactOutcome> {
  if ((await ports.list.findDevice(browser, device, deadline)) === null) return { kind: "no_session" };
  const user = await ports.contacts.chatUserOf(did, deadline);
  return user === null ? { kind: "missing" } : { kind: "found", user };
}

/**
 * The lexicon's longest display name: sh.unset.profile `displayName` maxLength 640, counted in UTF-8 bytes
 * (@atproto/lexicon 0.7.19 dist/validators/primitives.js:149-186, utf8Len). A longer one is not a valid record, so it
 * is never shown; the chat page clamps what it shows to the lexicon's 64 graphemes.
 */
const MAX_NAME_BYTES = 640;

export type ChatNames = {
  /** The public profile name of `user` when their chat is ready and their public page shows; null otherwise. */
  nameOf(user: ChatUser, deadline: AbortSignal): Promise<string | null>;
};

export type NameOutcome =
  | { readonly kind: "found"; readonly name: string }
  | { readonly kind: "missing" }
  | { readonly kind: "no_session" };

type NamePorts = { readonly list: BrowserList; readonly names: ChatNames };
type NameRequest = {
  readonly browser: BrowserKey;
  readonly device: DeviceId;
  readonly user: ChatUser;
  readonly deadline: AbortSignal;
};

/**
 * The name a chat partner is shown by (ADR 0107): any browser signed in to chat may ask for any member's, by chat
 * user, and learns it only where their public page would show it; an empty or invalid name reads as missing too.
 */
export async function chatName(
  ports: NamePorts,
  { browser, device, user, deadline }: NameRequest,
): Promise<NameOutcome> {
  if ((await ports.list.findDevice(browser, device, deadline)) === null) return { kind: "no_session" };
  const name = await ports.names.nameOf(user, deadline);
  if (name === null || name === "" || Buffer.byteLength(name, "utf8") > MAX_NAME_BYTES) return { kind: "missing" };
  return { kind: "found", name };
}
