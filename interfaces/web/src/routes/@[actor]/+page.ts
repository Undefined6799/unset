// The public profile runs SvelteKit's client (ADR 0114; book P1.22e): the first public page switched on. policy.ts
// says so too (`client`), which is what gives the page the app group's script policy; the server still draws the whole
// page, so it reads the same with script off (kit docs, page options: https://svelte.dev/docs/kit/page-options#csr,
// kit 3.2.0).
export const csr = true;
