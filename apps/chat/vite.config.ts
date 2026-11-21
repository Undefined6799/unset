// The chat page's build (ADR 0088): one static page for unset.cc, built by Vite 8.3.5 with Svelte's own Vite plugin and
// Tailwind's, into dist/page/: index.html and content-hashed files under /assets/ that the door serves (interfaces/chat-auth
// page.ts). No SvelteKit: the page has no server rendering and, for now, one screen at a time.
// assetsInlineLimit 0 (Vite 8.3.5 build.assetsInlineLimit, default 4096 bytes): nothing becomes a data: URL, which the
// page's CSP does not allow; the rust-crypto WASM, loaded by `new URL(..., import.meta.url)` in
// @matrix-org/matrix-sdk-crypto-wasm 18.9.2 index.mjs:24, is emitted as its own file the same way.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  tsconfig: "tsconfig.svelte.json",
  build: { outDir: "dist/page", emptyOutDir: true, assetsInlineLimit: 0, target: "es2024" },
  plugins: [tailwindcss(), svelte()],
});
