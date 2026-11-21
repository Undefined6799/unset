// The page's half of the chat count (ADR 0082 decision 1, ADR 0090 decision 1): once this browser is ready, it asks
// the door for a pushkey for the device it holds, and the adapter registers it as this device's pusher. Same-origin
// and uncached, like the setup claim; only a well-formed answer counts, anything else is null and chat goes on.
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Where the homeserver sends this device's count: the door's key for it and its internal notify address. */
export type PushTarget = { readonly pushkey: string; readonly url: string };

const PUSHKEY = /^[A-Za-z0-9_-]{43}$/;
const NOTIFY_URL = /^http:\/\/[a-z0-9.-]+(?::\d{1,5})?\/_matrix\/push\/v1\/notify$/;

export async function askPushKey(fetchFn: Fetch, deviceId: string, deadline: AbortSignal): Promise<PushTarget | null> {
  let body: unknown;
  try {
    const response = await fetchFn("/push/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: deadline,
    });
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }
  const { pushkey, url } = (body ?? {}) as Record<string, unknown>;
  if (typeof pushkey !== "string" || !PUSHKEY.test(pushkey)) return null;
  if (typeof url !== "string" || !NOTIFY_URL.test(url)) return null;
  return { pushkey, url };
}
