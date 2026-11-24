// Signup's chat step runs SvelteKit's client under the app's script policy, as every page a person reads does (ADR
// 0116 point 4). The page says so itself (book P1.22j: https://svelte.dev/docs/kit/page-options#csr). It is a card
// with one link or one form, the same with script off.
export const csr = true;
