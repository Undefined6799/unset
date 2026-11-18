// The root layout's load (P1.20d): the `?error=` code a redirect carried, only when it is a catalog code
// (readErrorParam), so no request text reaches the page. No script by default: a page that runs SvelteKit's client
// (group "app") says `export const csr = true` in its +page.ts; every other page, the error page for an unmatched
// path included, ships none (kit docs, page options: https://svelte.dev/docs/kit/page-options#csr, kit 3.2.0).
import { readErrorParam } from "@unset/shared-errors";
import type { LayoutLoad } from "./$types";

export const csr = false;

export const load: LayoutLoad = ({ url }) => ({ error: readErrorParam(url.searchParams) });
