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
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      // One script and one stylesheet for the whole client (kit 3.2.0 types/index.d.ts, output.bundleStrategy, since
      // 2.13.0). With 'split', a cold app page asked for 27 files, over the edge's app_burst of 20 per 10 s
      // (deployment/edge/snippets/ratelimit.caddy); 'single' makes it 5, as the Hono pages were sized for (P1.20j).
      output: { bundleStrategy: "single" },
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
          "trusted-types": ["svelte-trusted-html", "sveltekit-trusted-url"],
        },
      },
    }),
  ],
});
