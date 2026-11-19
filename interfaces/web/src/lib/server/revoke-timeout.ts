// The time limit on revoking an OAuth grant, shared by sign-out (sign-out.ts) and the under-age block (welcome.ts).
// Its own file so it imports no services and can be tested alone.

/** Book P2.08: the revocation call gets 10 seconds. */
const REVOKE_MS = 10_000;

/**
 * `work`, or a rejection after 10 seconds or when `deadline` aborts, whichever comes first. Sign-out and the under-age
 * block (welcome.ts) both revoke a grant through it. `work` is already running, so it is always observed: a late
 * rejection must not be an unhandled one, which drains web (server.ts).
 */
export function withRevokeTimeout(work: Promise<void>, deadline: AbortSignal): Promise<void> {
  const limit = AbortSignal.any([deadline, AbortSignal.timeout(REVOKE_MS)]);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("revoke timed out"));
    work.then(resolve, reject).finally(() => limit.removeEventListener("abort", onAbort));
    if (limit.aborted) onAbort();
    else limit.addEventListener("abort", onAbort, { once: true });
  });
}
