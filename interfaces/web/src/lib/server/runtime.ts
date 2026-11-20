// The process note as the SvelteKit side reads it (note.ts). Under the built server, server.ts has published it; under
// `vite dev` nothing has, so the settings load here; while SvelteKit builds, no settings exist and none are read.

import { bootOrExit } from "@unset/shared-config";
import { building } from "$app/env";
import { schema, type WebConfig } from "./config.ts";
import { publishedNote, type RequestNote, type Shutdown } from "./note.ts";

const note = publishedNote();

export const config: WebConfig = note?.config ?? (building ? ({} as WebConfig) : bootOrExit(schema));
export const requestNote = (): RequestNote | undefined => note?.requests.getStore();
/** Shutdown steps; under `vite dev` nobody runs them. */
export const shutdown: Shutdown = note?.shutdown ?? { draining: [], close: [] };
/** The build's stylesheet path for the gate's refusal page (server.ts sets it once it has loaded the build, so it is
 * read here per call); none under `vite dev`. */
export const stylesheet = (): string | undefined => note?.stylesheet;
