// The invite request runs SvelteKit's client (ADR 0116; book P1.22g), and asking is still a plain form, so it works the
// same with script off. The page says so itself (book P1.22j; kit docs, page options:
// https://svelte.dev/docs/kit/page-options#csr, kit 3.2.0).
export const csr = true;
