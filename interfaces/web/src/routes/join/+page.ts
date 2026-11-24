// The join page runs SvelteKit's client under the app group's script policy, as every page a person reads does (ADR
// 0116 point 4; book P1.22l). The page says so itself (book P1.22j:
// https://svelte.dev/docs/kit/page-options#csr). Joining with an invite is still one plain form.
export const csr = true;
