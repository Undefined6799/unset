// The GET routes that may change state (P1.07 step 10). A GET is never CSRF-gated, so `defineRoute` refuses
// `{ method: "GET", mutates: true }` for any path not listed here. Adding an entry is a security-reviewed change.

export type GetMutationException = Readonly<{ path: string; reason: string; protection: string }>;

export const GET_MUTATION_EXCEPTIONS: readonly GetMutationException[] = Object.freeze([
  Object.freeze({
    path: "/oauth/callback",
    reason:
      "the OAuth redirect back is a GET (P2.06): it consumes the login nonce, stores the sealed token set and " +
      "creates the session",
    protection: "state ↔ __Host- nonce binding, single-use in the P1.16 store (plan §2 rule 2); not CSRF",
  }),
]);
