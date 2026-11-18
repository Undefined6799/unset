import type { Actions } from "@sveltejs/kit";

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    return { length: String(form.get("text") ?? "").length };
  },
};
