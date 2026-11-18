import type { Actions, ServerLoad } from "@sveltejs/kit";

export const load: ServerLoad = ({ locals }) => ({ signedIn: locals.did !== undefined });

export const actions: Actions = {
  default: () => ({ saved: true }),
};
