import type { Actions, ServerLoad } from "@sveltejs/kit";

export const load: ServerLoad = ({ locals }) => ({
  signedIn: locals.did !== undefined,
  privacyNotice: locals.privacyNotice,
});

export const actions: Actions = {
  default: () => ({ saved: true }),
};
