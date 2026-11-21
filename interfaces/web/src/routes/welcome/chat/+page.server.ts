// GET and POST /welcome/chat (book P6.17; ADR 0083 decision 2): the required chat step of signup. The recovery key is
// made and saved on unset.cc, where the member's keys live, never here: the step links to the chat page's onboarding
// route there, which runs the stock first sign-in setup (ADR 0089) and registers the count's pusher (ADR 0082), then
// sends the tab back here through the door. Signup finishes only when the door says a browser of the member did so
// (it took the count's pushkey, which the page asks for only once ready); no answer, or a door that is down, keeps
// the member on the step (fail closed). While the chat account is not created yet (the queued job of build step 5),
// the step says so rather than send the member to a sign-in that cannot work yet.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import type { Did } from "@unset/domains-identity";
import { services } from "../../../lib/server/compose.ts";
import { config } from "../../../lib/server/runtime.ts";
import { elsewhere, requireStep } from "../../../lib/server/welcome.ts";
import { member, STEP_SHELL, stepPage } from "../onboarding.server.ts";

/** What the step shows: chat still being created, the link to set it up, or Continue. */
export type ChatStepView = "getting_ready" | "set_up" | "done";

const setUp = async (did: Did, deadline: AbortSignal) => (await services().chat.setUp(did, deadline)) === true;

async function viewOf(did: Did, deadline: AbortSignal): Promise<ChatStepView> {
  if ((await services().chat.readyUser(did, deadline)) === null) return "getting_ready";
  return (await setUp(did, deadline)) ? "done" : "set_up";
}

export const load: ServerLoad = async (event) => {
  const session = stepPage(event);
  await requireStep(session, event.locals.deadline, "chat");
  return {
    shell: STEP_SHELL,
    view: await viewOf(session.did, event.locals.deadline),
    setUpHref: `${config.CHAT_DOOR_ORIGIN}/welcome`,
  };
};

export const actions: Actions = {
  default: async (event) => {
    const session = member(event);
    const { deadline } = event.locals;
    await requireStep(session, deadline, "chat");
    if (!(await setUp(session.did, deadline))) redirect(303, "/welcome/chat");
    if (!(await services().accounts.finishChat(session.did, deadline))) return elsewhere(session, deadline);
    redirect(303, session.emailConfirmed === true ? "/me" : "/verify-email");
  },
};
