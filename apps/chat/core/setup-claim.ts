// The page's half of the setup claim (ADR 0089): before it makes an account's keys, and again before it stores them,
// the page asks the door to let this browser alone run the setup, naming only the device it holds; when the setup is
// done it releases the claim. Same-origin, uncached; the door's answers become three outcomes, never its words.
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type ClaimOutcome = "claimed" | "elsewhere" | "unavailable";

async function post(fetchFn: Fetch, path: string, deviceId: string, deadline: AbortSignal) {
  try {
    const response = await fetchFn(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: deadline,
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> | null };
  } catch {
    return null;
  }
}

export async function claimSetup(fetchFn: Fetch, deviceId: string, deadline: AbortSignal): Promise<ClaimOutcome> {
  const answer = await post(fetchFn, "/setup/claim", deviceId, deadline);
  if (answer?.status === 200 && answer.body?.claimed === true) return "claimed";
  return answer?.status === 409 ? "elsewhere" : "unavailable";
}

export async function releaseSetup(fetchFn: Fetch, deviceId: string, deadline: AbortSignal): Promise<boolean> {
  const answer = await post(fetchFn, "/setup/release", deviceId, deadline);
  return answer?.status === 200 && answer.body?.released === true;
}
