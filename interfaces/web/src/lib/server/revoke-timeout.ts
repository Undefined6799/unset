// The time limit on revoking an OAuth grant, shared by sign-out (sign-out.ts) and the under-age block (welcome.ts).
// Its own file so it imports no services and can be tested alone.

/** Book P2.08: the revocation call gets 10 seconds. */
const REVOKE_MS = 10_000;

/**
 * `work`, or a rejection after 10 seconds or when `deadline` aborts, whichever comes first. Sign-out and the under-age
 * block (welcome.ts) both revoke a grant through it.
 */
export function withRevokeTimeout(work: Promise<void>, deadline: AbortSignal): Promise<void> {
  const limit = AbortSignal.any([deadline, AbortSignal.timeout(REVOKE_MS)]);
  if (limit.aborted) return Promise.reject(new Error("revoke timed out"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("revoke timed out"));
    limit.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => limit.removeEventListener("abort", onAbort));
  });
}
