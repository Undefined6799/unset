// SvelteKit 3 takes its options through the sveltekit() plugin; svelte.config.js is refused (@sveltejs/kit 3.2.0
// src/exports/vite/index.js, config_file_unsupported). The CSP is ADR 0054 decision 4: mode "hash" adds the sha256 of
// the startup script SvelteKit writes; hooks.server.ts narrows 'self' in the file directives to our paths at runtime.
// Trusted Types names the policies Svelte 5.57.3 and SvelteKit create (svelte src/internal/client/dom/reconciler.js,
// kit src/runtime/server/page/render.js). No prerendering (ADR 0056): every response passes the hook.
import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // One tsconfig for every file the build transforms (Vite 8.3.5 UserConfig.tsconfig, passed to rolldown as a fixed
  // path, dist/node/chunks/node.js). Without it a file outside this folder is matched against the root solution file,
  // whose references name tests/, which the image's build context leaves out (P1.20j).
  tsconfig: "tsconfig.json",
  // Never inline an imported file as a data: URL (Vite 8.3.5 build.assetsInlineLimit, default 4096 bytes): no policy
  // here allows data:, so the 1 KB favicon would not load. Every file is emitted under /_app/ instead (P1.20k).
  build: { assetsInlineLimit: 0 },
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      // A small core plus one piece per route and per shared module, each content-hashed under /_app/immutable/ (kit
      // 3.2.0 src/exports/vite/public.d.ts, output.bundleStrategy, the default; P1.21g, ADR 0069). 'single' turns off
      // rolldown's code splitting (build/index.js: codeSplitting false), which also folds every dynamic import into the
      // one file, so nothing could ever load on demand. A cold app page now asks for about 30 files at once: the edge
      // counts them in their own zone, app_files (deployment/edge/snippets/ratelimit.caddy), never in app_burst.
      // SvelteKit's version check (version.json) turns a click that needs a piece a redeploy removed into a full load.
      output: { bundleStrategy: "split" },
      csp: {
        mode: "hash",
        directives: {
          "default-src": ["none"],
          "script-src": ["self"],
          "style-src": ["self"],
          // Two fixed style attributes, allowed by exact hash only: SvelteKit's route announcer
          // (kit src/runtime/components/root.svelte) and Bits UI's hidden form input.
          "style-src-attr": [
            "unsafe-hashes",
            "sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=",
            "sha256-VLgFcXpEe+O6FcWgF9ZsmG0zmp66HOx0AKvg+TMAbTo=",
          ],
          "img-src": ["self"],
          "font-src": ["self"],
          "connect-src": ["self"],
          "form-action": ["self"],
          "base-uri": ["none"],
          "frame-ancestors": ["none"],
          "object-src": ["none"],
          "manifest-src": ["self"],
          "require-trusted-types-for": ["script"],
          // ProseMirrorClipboard (ADR 0073): prosemirror-view 1.42.9 parses pasted HTML in a detached element through
          // this one policy (dist/index.js, maybeWrapTrusted), on the owner's Text editor only.
          "trusted-types": ["svelte-trusted-html", "sveltekit-trusted-url", "ProseMirrorClipboard"],
        },
      },
    }),
  ],
});
