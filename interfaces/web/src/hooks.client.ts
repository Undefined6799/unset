// The browser's error hook (P1.20k; kit 3.2.0 HandleClientError, node_modules/@sveltejs/kit/types/index.d.ts, imported from @sveltejs/kit/hooks as hooks.server.ts does): an error
// SvelteKit's client meets itself, such as a client navigation that matches no page or a load that throws, gets a
// catalog code as the server's handleError gives one (hooks.server.ts), so +error.svelte shows the catalog's text and
// never the framework's own words or an error's message. An error the server sent is already a catalog code.
import type { HandleClientError } from "@sveltejs/kit/hooks";

export const handleError: HandleClientError = (caught) => {
  if (caught.kind === "app") return caught.error;
  if (caught.kind === "framework" && caught.error.status === 404) return { message: "http.not_found" };
  return { message: "internal.error" };
};
