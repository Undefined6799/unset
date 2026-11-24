// GET and POST /invite (book P2.10; plan §5.3 "Login and signup"): a member asks for a one-use sign-up code for our
// PDS, sees the codes of the last 7 days as join links, and hides the ones they no longer need. The gate has checked
// the session, onboarding, the confirmed email, the Origin and the invite limit. pds-admin issues the code (ADR 0060);
// the identity domain's rule makes one form submission one request and one row.
import { randomUUID } from "node:crypto";
import { type Actions, type RequestEvent, redirect, type ServerLoad } from "@sveltejs/kit";
import { type Did, issueMemberInvite, parseInviteId, parseSubmissionId } from "@unset/domains-identity";
import { withErrorParam } from "@unset/shared-errors";
import { services } from "../../lib/server/compose.ts";
import { config } from "../../lib/server/runtime.ts";
import { single } from "../../lib/server/sign-in.ts";
import type { ShellData } from "../../lib/shell.ts";

const countryRule = (): boolean => config.INVITE_COUNTRY_RULE === "on";

/** The link an invitee opens; the code is its only query value. */
const joinLink = (code: string): string => `${config.PUBLIC_ORIGIN}/join?${new URLSearchParams({ invite: code })}`;

function member(event: Pick<RequestEvent, "locals">): Did {
  const { did } = event.locals;
  if (did === undefined) throw new Error("invite: the gate let a request through with no session");
  return did;
}

export const load: ServerLoad = async (event) => {
  const did = member(event);
  event.setHeaders({ "x-robots-tag": "noindex" });
  const listed = await services().invites.store.list(did, event.locals.deadline);
  const left = event.url.searchParams.get("left");
  const shell: ShellData = { kind: "core", noindex: true }; // the account button is the layout's
  return {
    shell,
    // A new id per render: a second press of the same form is one invite, a new render is a new one (rule 12a).
    submissionId: randomUUID(),
    countryRule: countryRule(),
    left: left !== null && /^[0-9]{1,3}$/.test(left) ? Number(left) : null,
    invites: listed.map((item) => ({
      id: item.id,
      link: item.code === null ? null : joinLink(item.code),
      createdAt: item.createdAt.toISOString(),
      expiresAt: item.expiresAt.toISOString(),
    })),
  };
};

export const actions: Actions = {
  issue: async (event) => {
    const did = member(event);
    const { deadline } = event.locals;
    const form = await event.request.formData();
    if (countryRule() && single(form, "countryAck") !== "yes") {
      redirect(303, withErrorParam("/invite", "invite.country_ack_required"));
    }
    const submission = parseSubmissionId(single(form, "submissionId"));
    if (submission === null) redirect(303, withErrorParam("/invite", "invite.bad_submission"));
    const { invites, log } = services();
    const outcome = await issueMemberInvite(
      {
        claim: (who, id) => invites.store.claim(who, id, deadline),
        issue: (who) => invites.issue(who, deadline),
        store: (who, id, code) => invites.store.store(who, id, code, deadline),
        drop: (who, id) => invites.store.drop(who, id, deadline),
        denied: (who) => invites.denied(who, deadline),
      },
      did,
      submission,
    );
    switch (outcome.kind) {
      case "issued":
        redirect(303, outcome.remaining === null ? "/invite" : `/invite?left=${outcome.remaining}`);
        break;
      case "refused":
        redirect(303, withErrorParam("/invite", outcome.code));
        break;
      case "store_failed":
        log.error("invite.store_failed", {});
        redirect(303, withErrorParam("/invite", "invite.unavailable"));
        break;
      default: {
        const unexpected: never = outcome;
        return unexpected;
      }
    }
  },

  // Hides the caller's own row; any other id changes nothing and reads the same (rule SE-2).
  hide: async (event) => {
    const did = member(event);
    const form = await event.request.formData();
    const id = parseInviteId(single(form, "id"));
    if (id !== null) await services().invites.store.hide(did, id, event.locals.deadline);
    redirect(303, "/invite");
  },
};
