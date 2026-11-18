// GET and POST /welcome/age (P2.12, P2.12e). Three empty fields and no hint of a threshold. Every valid date is shown
// back once before it counts, whatever it is, so a slip of the keyboard can be corrected and the question tells
// nobody which answers pass. Nothing is decided or stored until it returns confirmed; the date is never stored.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { ageInYears, latestCalendarDay, parseBirthDate } from "@unset/domains-identity";
import { services } from "../../../lib/server/compose.ts";
import { config } from "../../../lib/server/runtime.ts";
import { single } from "../../../lib/server/sign-in.ts";
import { blockUnderage, elsewhere, requireStep } from "../../../lib/server/welcome.ts";
import { member, STEP_SHELL, stepPage } from "../onboarding.server.ts";

export const load: ServerLoad = async (event) => {
  await requireStep(stepPage(event), event.locals.deadline, "age");
  return { shell: STEP_SHELL };
};

export const actions: Actions = {
  default: async (event) => {
    const session = member(event);
    const { deadline } = event.locals;
    await requireStep(session, deadline, "age");
    const form = await event.request.formData();
    // The latest calendar day anywhere, so a birthday that has arrived where the person lives counts (P2.12e).
    const today = latestCalendarDay(new Date());
    const field = (name: string) => single(form, name) ?? "";
    const birth = parseBirthDate({ day: field("day"), month: field("month"), year: field("year") }, today);
    if (birth === null) redirect(303, "/welcome/age?error=welcome.date_invalid");
    if (single(form, "confirmed") !== "yes") return { confirm: birth };
    if (ageInYears(birth, today) < config.MIN_AGE) return blockUnderage(session, event.cookies, deadline);
    const { accounts } = services();
    if (!(await accounts.confirmAdult(session.did, deadline))) return elsewhere(session, deadline);
    redirect(303, "/welcome/terms");
  },
};
