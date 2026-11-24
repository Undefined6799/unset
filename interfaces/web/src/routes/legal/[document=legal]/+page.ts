// The legal pages run SvelteKit's client (ADR 0116; book P1.22g). The page says so itself (book P1.22j); the server
// still draws the whole page, so it reads the same with script off (kit docs, page options:
// https://svelte.dev/docs/kit/page-options#csr, kit 3.2.0).
export const csr = true;
