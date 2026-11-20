// Invite requests (book P2.10r; ADR 0080): the window that remembers which addresses asked, and the one mail to the
// owner. The window lives in this process's memory only, as a keyed hash made with a key drawn at boot, so no address
// is ever written to disk or the database, and a restart forgets every one (a repeat after a restart mails the owner
// again, which the site-wide limit of 20 a day bounds). Only addresses whose request was accepted are remembered, so
// the same limit bounds the map; MAX_REMEMBERED is a backstop that drops the oldest first.
import { createHmac, randomBytes } from "node:crypto";
import type { InviteRequestPorts, RequesterEmail } from "@unset/domains-identity";
import type { Mailer } from "@unset/infrastructure-email";

/** An address asks once per 30 days. */
export const ASK_WINDOW_MS = 30 * 24 * 3600 * 1000;
/** Far above the 20 a day the limit lets through in 30 days (620); reaching it drops the oldest entry. */
const MAX_REMEMBERED = 2000;

export type AskWindow = Pick<InviteRequestPorts, "firstAsk" | "forget">;

export function createAskWindow(options: { now: () => number; windowMs?: number; max?: number }): AskWindow {
  const key = randomBytes(32);
  const windowMs = options.windowMs ?? ASK_WINDOW_MS;
  const max = options.max ?? MAX_REMEMBERED;
  /** Keyed hash of the lower-cased address → when it may ask again. Insertion order is expiry order. */
  const until = new Map<string, number>();
  const idOf = (email: RequesterEmail): string =>
    createHmac("sha256", key).update(email.toLowerCase()).digest("base64url");
  const prune = (now: number): void => {
    for (const [id, at] of until) {
      if (at > now && until.size < max) return;
      until.delete(id);
    }
  };
  return {
    firstAsk: (email) => {
      const now = options.now();
      prune(now);
      const id = idOf(email);
      if (until.has(id)) return false;
      until.set(id, now + windowMs);
      return true;
    },
    forget: (email) => {
      until.delete(idOf(email));
    },
  };
}

/** The owner's mail: the address, where to make the invite, and that replying writes to the visitor. */
export function ownerNotice(email: RequesterEmail, origin: string): { subject: string; text: string } {
  return {
    subject: "Invite request on unset",
    text: [
      "Someone asked for an invite to unset.",
      "",
      `Their email address: ${email}`,
      "",
      `To invite them, make an invite at ${origin}/invite and send them the link from your own mailbox.`,
      "Replying to this message writes to them.",
      "",
      "unset keeps no copy of this address. Delete this message once you have answered.",
    ].join("\n"),
  };
}

/** The notify port: one mail to `to`, with the visitor as Reply-To. */
export function notifyOwner(
  mailer: Mailer,
  to: string,
  origin: string,
  deadline: AbortSignal,
): InviteRequestPorts["notify"] {
  return (email) => mailer.send({ to, replyTo: email, ...ownerNotice(email, origin) }, deadline);
}
