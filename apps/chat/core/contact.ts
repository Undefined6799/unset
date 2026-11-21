// The page's half of a profile's Message link (ADR 0094 decision 6, ADR 0101 decision 3). unset.sh links to
// `/dm/<did>`; that path survives the sign-in hop as its return path (the door keeps it in its return cookie and
// hands it back at redeem), and once signed in the page asks the door for the member's chat ID with the device it
// holds, then goes on at the start route `/?with=<chat ID>` (core/conversations.ts startTarget). A member the door
// does not find goes on at `/?with=`, which the list answers as a chat ID it does not know: the page never says
// whether that member has chat.
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const DM_PATH = /^\/dm\/(did:[a-z]+:[A-Za-z0-9._:%-]{1,2048})$/;
const CHAT_ID = /^@[a-z0-9._=/+-]+:[A-Za-z0-9.-]+$/;

/** The DID a Message link names, or null for any other path. */
export function dmTarget(path: string): string | null {
  return DM_PATH.exec(path)?.[1] ?? null;
}

/** Where the page goes on for the member `did`: the start route with their chat ID, or `/?with=` without one. */
export async function startPathFor(fetchFn: Fetch, deviceId: string, did: string, deadline: AbortSignal) {
  let body: unknown = null;
  try {
    const response = await fetchFn("/chat-id", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, did }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: deadline,
    });
    if (response.ok) body = await response.json();
  } catch {
    body = null;
  }
  const chatId = (body as { chatId?: unknown } | null)?.chatId;
  return typeof chatId === "string" && CHAT_ID.test(chatId) ? `/?with=${encodeURIComponent(chatId)}` : "/?with=";
}
