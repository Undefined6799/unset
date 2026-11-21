// Invite requests (book P2.10r, ADR 0080): while sign-up is invite only, a visitor leaves an email address and the
// owner gets one mail with it, then sends an invite link from their own mailbox. The rule: an address is parsed once,
// strictly; the same address asks at most once per window, and a repeat reads exactly like a first ask, so the page
// never tells anyone whether an address asked before; mail goes only to the owner, never to the address typed.
// The ports are I/O and non-determinism only (rule AB-2): web wires its in-memory window and the mailer to them.

declare const requesterBrand: unique symbol;
/** An email address a visitor typed, as parsed by `parseRequesterEmail`: ASCII, no space, quote or line break. */
export type RequesterEmail = string & { readonly [requesterBrand]: true };

/** RFC 5321's limits: 64 octets of local part, 254 in all (its 256-octet path less the angle brackets). */
const MAX_LOCAL = 64;
const MAX_ADDRESS = 254;
/** The local part's dot-atom characters (RFC 5322 §3.2.3, atext, no quoted strings) and a dotted host name. */
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** The address, trimmed and with its domain lower-cased, or null for anything we would not send to. */
export function parseRequesterEmail(raw: string | null): RequesterEmail | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length > MAX_ADDRESS) return null;
  const at = value.lastIndexOf("@");
  if (at < 1) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > MAX_LOCAL || !LOCAL.test(local) || !DOMAIN.test(domain)) return null;
  return `${local}@${domain.toLowerCase()}` as RequesterEmail;
}

export type InviteRequestPorts = {
  /** Records the address for the window and says whether it is new; false when it asked within the window. */
  readonly firstAsk: (email: RequesterEmail) => boolean;
  /** Forgets the address again, so a request whose mail failed can be sent again. */
  readonly forget: (email: RequesterEmail) => void;
  /** The one mail to the owner, naming the address. */
  readonly notify: (email: RequesterEmail) => Promise<"sent" | "failed">;
};

/** `received` for a first ask whose mail went and for a repeat alike; `failed` when the owner's mail did not go. */
export type InviteRequestOutcome = "received" | "failed";

export async function requestInvite(ports: InviteRequestPorts, email: RequesterEmail): Promise<InviteRequestOutcome> {
  if (!ports.firstAsk(email)) return "received";
  const sent = await ports.notify(email);
  if (sent === "sent") return "received";
  ports.forget(email);
  return "failed";
}
