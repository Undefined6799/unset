// The time a grant revocation may take (book P2.08), shared by sign-out (logout.ts) and the under-16 block
// (welcome.ts). Each caller decides what a timeout means for the stored token set.

/** Book P2.08: the revocation call gets 10 seconds. */
const REVOKE_MS = 10_000;

class RevokeTimeout extends Error {
  constructor() {
    super("revoke timed out");
    this.name = "RevokeTimeout";
  }
}

/** `work`, or a `RevokeTimeout` rejection after 10 seconds or when `deadline` aborts, whichever comes first. */
export function withRevokeTimeout(work: Promise<void>, deadline: AbortSignal): Promise<void> {
  if (deadline.aborted) return Promise.reject(new RevokeTimeout());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RevokeTimeout()), REVOKE_MS);
    const onAbort = () => reject(new RevokeTimeout());
    deadline.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      deadline.removeEventListener("abort", onAbort);
    });
  });
}
