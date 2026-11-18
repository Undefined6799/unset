// Invite quotas (P2.09 step 10; ADR 0060 decision 4). Pure: the counts come from the PDS (an account's codes) and from
// this service's log (today's codes); the caller passes them in.

export type QuotaResult =
  | { readonly ok: true; readonly remaining: number; readonly availableAt: number | null }
  | { readonly ok: false; readonly availableAt: number };

/**
 * Whether one more code fits `max` per `windowMs` for an account whose codes were created at `createdAt` (ms).
 * On success, `remaining` counts the code about to be issued, and `availableAt` says when the next one frees up if
 * none remain; on refusal, `availableAt` is when the oldest code in the window leaves it.
 */
export function accountQuota(createdAt: readonly number[], now: number, windowMs: number, max: number): QuotaResult {
  const inWindow = createdAt.filter((at) => at > now - windowMs && at <= now).sort((a, b) => a - b);
  if (inWindow.length >= max) return { ok: false, availableAt: (inWindow[inWindow.length - max] ?? now) + windowMs };
  const remaining = max - inWindow.length - 1;
  const after = [...inWindow, now];
  return { ok: true, remaining, availableAt: remaining === 0 ? (after[after.length - max] ?? now) + windowMs : null };
}

/** The start of `now`'s UTC day, in ms. */
export const utcMidnight = (now: number): number => now - (now % 86_400_000);

/** Whether one more code fits the server-wide daily cap, given how many this service issued today. */
export function globalQuota(issuedToday: number, now: number, max: number): QuotaResult {
  if (issuedToday >= max) return { ok: false, availableAt: utcMidnight(now) + 86_400_000 };
  return { ok: true, remaining: max - issuedToday - 1, availableAt: null };
}
