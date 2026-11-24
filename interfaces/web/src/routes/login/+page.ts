// The sign-in page runs SvelteKit's client under the app's script policy, as every page a person reads does (ADR 0116
// point 4; book P1.22l). The page says so itself (book P1.22j:
// https://svelte.dev/docs/kit/page-options#csr). Signing in is still one plain form: with script off, or before the
// client is ready, the button posts the page as it always did.
export const csr = true;
