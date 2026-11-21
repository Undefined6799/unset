// A chat partner's public name (ADR 0096): the name on their unset.sh profile, shown over their handle. The door
// answers it for a chat ID (POST /chat-name) to a page that holds a device; this page asks once per chat ID and keeps
// the answer in memory only. What it shows is cleaned first: bidi controls (which could reorder the handle beside it)
// and control characters go, runs of space fold, and it is cut to the lexicon's 64 graphemes (sh.unset.profile
// displayName maxGraphemes). No answer, or nothing left, shows the handle alone.
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** sh.unset.profile `displayName` maxGraphemes (shared/lexicons/schemas/sh.unset.profile.json). */
const MAX_GRAPHEMES = 64;
/** The Unicode bidi controls (UAX #9 section 2: ALM, LRM, RLM, LRE..RLO, LRI..PDI) and every control character. */
const HIDDEN = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]|[\p{Cc}--[\t\n\r]]/gv;
const SPACES = /[\s\p{Zs}]+/gu;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `raw` as it may be shown, or null when it is not a string or nothing is left. */
export function shownName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(HIDDEN, "").replace(SPACES, " ").trim();
  if (clean === "") return null;
  const parts = Array.from(graphemes.segment(clean), (s) => s.segment);
  return parts.length <= MAX_GRAPHEMES
    ? clean
    : `${parts
        .slice(0, MAX_GRAPHEMES - 1)
        .join("")
        .trimEnd()}…`;
}

async function ask(fetchFn: Fetch, deviceId: string, chatId: string, deadline: AbortSignal): Promise<string | null> {
  try {
    const response = await fetchFn("/chat-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, chatId }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: deadline,
    });
    return response.ok ? shownName(((await response.json()) as { name?: unknown } | null)?.name) : null;
  } catch {
    return null;
  }
}

/** The page's lookup: a chat ID's shown name or null, asked of the door once per chat ID while the page is open. */
export function publicNames(fetchFn: Fetch, deviceId: string, deadline: () => AbortSignal) {
  const asked = new Map<string, Promise<string | null>>();
  return (chatId: string): Promise<string | null> => {
    let answer = asked.get(chatId);
    if (answer === undefined) {
      answer = ask(fetchFn, deviceId, chatId, deadline());
      asked.set(chatId, answer);
    }
    return answer;
  };
}
