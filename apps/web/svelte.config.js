// For svelte-check only (P1.20c): with no svelte.config.js it reads vite.config.ts, which builds the React UI and has no
// Svelte plugin. Svelte 5 compiles <script lang="ts"> itself, so no preprocessor is needed. The SvelteKit app in
// interfaces/web takes its own options through its Vite plugin.
// tsconfig.svelte.json: svelte-check 4.7.8 accepts typescript ^5 || ^6, so it runs on TypeScript 6 (ADR 0054
// Consequences) and tsconfig.json (tsc -b, TypeScript 7) excludes lib/. exactOptionalPropertyTypes is off there, as
// ADR 0056 point 8 allows for the web folder: stock components fail it.
export default {};
