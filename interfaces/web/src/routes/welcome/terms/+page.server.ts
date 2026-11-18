// GET and POST /welcome/terms (P2.12). The form names the versions it shows and the POST accepts only those, so an
// acceptance is always of the text the member saw. The country box is required only while the invite-country rule
// is on. A re-acceptance (the gate's "terms" outcome) carries the page to return to.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { type ErrorCode, withErrorParam } from "@unset/shared-errors";
import { type SafePath, safeReturnPath } from "@unset/shared-http";
import { services } from "../../../lib/server/compose.ts";
import { config } from "../../../lib/server/runtime.ts";
import { single } from "../../../lib/server/sign-in.ts";
import { elsewhere, requireStep } from "../../../lib/server/welcome.ts";
import { member, STEP_SHELL, stepPage } from "../onboarding.server.ts";

const countryRule = (): boolean => config.INVITE_COUNTRY_RULE === "on";

function termsPath(next: SafePath | null, code?: ErrorCode): string {
  const path = next === null ? "/welcome/terms" : `/welcome/terms?${new URLSearchParams({ next })}`;
  return code === undefined ? path : withErrorParam(path, code);
}

export const load: ServerLoad = async (event) => {
  await requireStep(stepPage(event), event.locals.deadline, "terms");
  const { versions } = services();
  return {
    shell: STEP_SHELL,
    countryRule: countryRule(),
    next: safeReturnPath(event.url.searchParams.get("next")),
    termsVersion: versions.terms,
    privacyVersion: versions.privacy,
  };
};

export const actions: Actions = {
  default: async (event) => {
    const session = member(event);
    const { deadline } = event.locals;
    await requireStep(session, deadline, "terms");
    const { accounts, versions } = services();
    const form = await event.request.formData();
    const next = safeReturnPath(single(form, "next"));
    const shown =
      single(form, "terms_version") === versions.terms && single(form, "privacy_version") === versions.privacy;
    if (!shown) redirect(303, termsPath(next));
    if (single(form, "accept") !== "yes") redirect(303, termsPath(next, "welcome.terms_required"));
    if (countryRule() && single(form, "country") !== "yes") redirect(303, termsPath(next, "welcome.country_required"));
    const step = await accounts.acceptTerms(session.did, versions.terms, versions.privacy, deadline);
    if (step === null) return elsewhere(session, deadline);
    redirect(303, step === "chat" ? "/welcome/chat" : (next ?? "/me"));
  },
};
