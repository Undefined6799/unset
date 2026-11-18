import type { ServerLoad } from "@sveltejs/kit";

export const load: ServerLoad = ({ locals }) => ({ signedIn: locals.did !== undefined });
