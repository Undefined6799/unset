// For svelte-check only (P1.20c): with no svelte.config.js it reads vite.config.ts, which builds the React UI and has no
// Svelte plugin. Svelte 5 compiles <script lang="ts"> itself, so no preprocessor is needed. The SvelteKit app in
// interfaces/web takes its own options through its Vite plugin.
export default {};
