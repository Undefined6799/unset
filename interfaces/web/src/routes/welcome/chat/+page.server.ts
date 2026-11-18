// GET and POST /welcome/chat (P2.12): the chat placeholder. Continuing marks onboarding done. P6.17 replaces it.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { services } from "../../../lib/server/compose.ts";
import { elsewhere, requireStep } from "../../../lib/server/welcome.ts";
import { member, STEP_SHELL, stepPage } from "../onboarding.server.ts";

export const load: ServerLoad = async (event) => {
  await requireStep(stepPage(event), event.locals.deadline, "chat");
  return { shell: STEP_SHELL };
};

export const actions: Actions = {
  default: async (event) => {
    const session = member(event);
    const { deadline } = event.locals;
    await requireStep(session, deadline, "chat");
    if (!(await services().accounts.finishChat(session.did, deadline))) return elsewhere(session, deadline);
    redirect(303, session.emailConfirmed === true ? "/me" : "/verify-email");
  },
};
