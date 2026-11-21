// The Message link's lookup (build step 10; ADR 0082 decision 6, ADR 0090 decision 3): a profile on unset.sh links to
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
