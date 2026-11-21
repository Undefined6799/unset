// The page's half of Log out (ADR 0083 decision 5): the door's POST /sign-out (interfaces/chat-auth/routes.ts
// signOutRoute) ends the device this browser holds through chat-admin, which removes the device and its pusher, and
// deletes the lock key. The page names only that device; same-origin, uncached. Done or not, never the door's words.
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** True once the door has ended `deviceId` for this browser; false for any other answer or none. */
export async function signOutDevice(fetchFn: Fetch, deviceId: string, deadline: AbortSignal): Promise<boolean> {
  try {
    const response = await fetchFn("/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: deadline,
    });
    const body = (await response.json()) as { signedOut?: unknown } | null;
    return response.status === 200 && body?.signedOut === true;
  } catch {
    return false;
  }
}
