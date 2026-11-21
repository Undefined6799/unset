// GET and POST /request-invite (book P2.10r; ADR 0080): a visitor leaves an email address and the owner gets one mail
// with it, then sends an invite link from their own mailbox. The address is parsed once (domains/identity); a repeat
// within 30 days, a filled trap field and a first ask all read the same, so the page tells nobody whether an address
// asked before, not even by how long the answer takes: the visitor is answered at once in every case and the mail is
// sent after, under its own deadline. Mail goes only to the owner; a failed mail is an entry in their inbox. The gate has checked the Origin, the body size and
// the limit.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { type Did, parseRequesterEmail, requestInvite } from "@unset/domains-identity";
import { withErrorParam } from "@unset/shared-errors";
import { services } from "../../lib/server/compose.ts";
import { notifyOwner } from "../../lib/server/invite-requests.ts";
import { sendInviteMailFailed } from "../../lib/server/notification-sources.ts";
import { config } from "../../lib/server/runtime.ts";
import { single } from "../../lib/server/sign-in.ts";

const PAGE = "/request-invite";
/** The send's own deadline, apart from the request's: the answer never waits for it (ADR 0080 point 4). */
const MAIL_DEADLINE_MS = 20_000;
/** The owner's inbox entry after a failed mail: one statement on web's pool. */
const NOTICE_DEADLINE_MS = 5000;

/**
 * A failed mail: logged, and put in the owner's inbox (P2.10s), so the owner learns of it without reading the logs.
 * The entry failing too is logged and nothing more: the visitor was answered long ago.
 */
async function mailFailed(owner: Did): Promise<void> {
  const { log } = services();
  log.error("invite.request_mail_failed", {});
  try {
    await sendInviteMailFailed(owner, new Date(), AbortSignal.timeout(NOTICE_DEADLINE_MS));
  } catch {
    log.error("invite.request_notice_failed", {});
  }
}

export const load: ServerLoad = ({ url, locals, setHeaders }) => {
  setHeaders({ "x-robots-tag": "noindex" });
  return {
    open: services().inviteRequests !== null,
    signedIn: locals.did !== undefined,
    received: url.searchParams.get("sent") === "1",
    minAge: config.MIN_AGE,
    countryRule: config.INVITE_COUNTRY_RULE === "on",
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    // A member makes invites themselves; nothing is sent for them.
    if (locals.did !== undefined) redirect(303, "/invite");
    const requests = services().inviteRequests;
    if (requests === null) redirect(303, PAGE);
    const form = await request.formData();
    const { log } = services();
    // The trap field: a person never sees it, so a value means a bot. It reads as sent and nothing goes.
    if ((single(form, "website") ?? "") !== "") {
      log.info("invite.request_received", { kind: "trap" });
      redirect(303, `${PAGE}?sent=1`);
    }
    const email = parseRequesterEmail(single(form, "email"));
    if (email === null) redirect(303, withErrorParam(PAGE, "invite.request_bad_email"));
    if (single(form, "ageAck") !== "yes") redirect(303, withErrorParam(PAGE, "invite.request_age_required"));
    if (config.INVITE_COUNTRY_RULE === "on" && single(form, "countryAck") !== "yes") {
      redirect(303, withErrorParam(PAGE, "invite.request_country_required"));
    }
    let first = false;
    // Not awaited: a first ask would otherwise answer only once the mail server had, and a repeat at once. The window
    // is read before requestInvite's first await, so `first` is set here; a failed mail forgets the address again.
    // Tracked, so a graceful shutdown waits for the send.
    requests.pending.track(
      requestInvite(
        {
          firstAsk: (who) => (first = requests.window.firstAsk(who)),
          forget: (who) => requests.window.forget(who),
          notify: notifyOwner(
            requests.mailer,
            requests.to,
            config.PUBLIC_ORIGIN,
            AbortSignal.timeout(MAIL_DEADLINE_MS),
          ),
        },
        email,
      ).then(
        (outcome) => {
          if (outcome !== "failed") return undefined;
          return mailFailed(requests.owner);
        },
        () => mailFailed(requests.owner),
      ),
    );
    log.info("invite.request_received", { kind: first ? "first" : "repeat" });
    redirect(303, `${PAGE}?sent=1`);
  },
};
