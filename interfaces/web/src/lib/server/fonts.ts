// The two fonts apps/web/app.css names, served at /fonts/<name> (ADR 0054 point 4: font-src /fonts/). Hono served
// them from /assets/; found missing at P1.20j. Each route folder is one exact file name, so no part of the request is
// ever a path. Vite emits each imported file into the build and SvelteKit's `read` (kit 3.2.0
// src/runtime/app/server/index.js, https://svelte.dev/docs/kit/$app-server#read) returns its bytes. The names carry no
// hash, so they are cached a day, not for good; they carry no personal data. The files and their OFL licences are
// copies of shared/ui/fonts, the design data's home; public-pages.test.ts keeps the served bytes equal to it (the
// edge keeps its own copy for the PDS pages).

import jetBrainsMono from "@unset/apps-web/lib/fonts/JetBrainsMono-Variable.woff2";
import spaceGrotesk from "@unset/apps-web/lib/fonts/SpaceGrotesk-Variable.woff2";
import { read } from "$app/server";

const FILES = { "JetBrainsMono-Variable.woff2": jetBrainsMono, "SpaceGrotesk-Variable.woff2": spaceGrotesk } as const;

/** The font `name` as a cached woff2 response. */
export async function font(name: keyof typeof FILES): Promise<Response> {
  const bytes = await read(FILES[name]).arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": "font/woff2", "cache-control": "public, max-age=86400" },
  });
}
