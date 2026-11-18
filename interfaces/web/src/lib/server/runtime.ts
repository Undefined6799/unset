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
