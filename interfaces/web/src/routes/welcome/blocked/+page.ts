// The under-age notice runs SvelteKit's client under the app's script policy, as every page a person reads does (ADR
// 0116 point 4; book P1.22l). The page says so itself (book P1.22j:
// https://svelte.dev/docs/kit/page-options#csr). It is a notice and one link, the same with script off.
export const csr = true;
