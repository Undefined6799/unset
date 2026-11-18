import { type Actions, error, type ServerLoad } from "@sveltejs/kit";

export const load: ServerLoad = ({ locals }) => ({ signedIn: locals.did !== undefined });

export const actions: Actions = {
  // The gate lets no POST through without a session; this would show it if one ever did.
  save: ({ locals }) => {
    if (locals.did === undefined) error(500, "internal.error");
    return { saved: true };
  },
};
