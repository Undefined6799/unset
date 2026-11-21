// What web sends into the notification inbox (P2.27, ADR 0079). Each source is one `notify` call through compose's
// notifications service, the same way any later source will send; nothing here reaches the inbox's rows directly.
import { type Did, requireOnboarded } from "@unset/domains-identity";
import type { Entry, Notification } from "@unset/domains-notifications";
import type { Db } from "@unset/infrastructure-postgres";
import { services } from "./compose.ts";

/**
 * A new sign-in to the account. Sent in the sign-in's own transaction, so only the member's browsers signed in before
 * it may see or clear it (migration 0036 `older_sessions_only`): whoever signed in cannot hide it. The time it was
 * sent is the session's start; nothing else about the sign-in is kept.
 */
export async function sendSignIn(tx: Db, did: Did): Promise<void> {
  const sent = await services().notifications.sendIn(tx, did, { reason: "sign_in", olderSessionsOnly: true });
  if (!sent.ok) throw new Error(sent.error);
}

const noticeKey = (version: string) => `privacy_notice:${version}`;

/** The privacy notice changed since the member accepted or dismissed it (the banner's own rule, P2.12b). */
function privacyNotice(version: string): Notification {
  return { reason: "privacy_notice", topic: version, dedupeKey: noticeKey(version) };
}

/**
 * At sign-in, the notice entry, when the banner would show: once per member and version (its dedupe key). A member
 * already signed in when a new notice is deployed has the banner, and this entry at their next sign-in.
 */
export async function sendPrivacyNoticeIfChanged(did: Did, deadline: AbortSignal): Promise<void> {
  const { accounts, versions, notifications } = services();
  const decision = requireOnboarded(await accounts.get(did, deadline), versions);
  if (decision.outcome !== "pass" || !decision.privacyNotice) return;
  const sent = await notifications.send(did, privacyNotice(versions.privacy), deadline);
  if (!sent.ok) throw new Error(sent.error);
}

/**
 * What a source does when its entry is dismissed, if anything: dismissing the notice's entry is seeing the change, as
 * the banner's dismiss is, so the notice is not sent again at the next sign-in (Codex review of 2491506). A source with
 * nothing to do adds nothing here; the routes call `dismissed` for every entry they delete.
 */
export async function dismissed(did: Did, entries: readonly Entry[], deadline: AbortSignal): Promise<void> {
  const { accounts, versions } = services();
  if (entries.some((entry) => entry.reason === "privacy_notice" && entry.topic === versions.privacy)) {
    await accounts.markPrivacyNoticeSeen(did, versions.privacy, deadline);
  }
}

/** The UTC day web last put an invite-mail notice in the owner's inbox; this process only. */
let inviteNoticeDay = "";

/**
 * An invite request whose mail to the owner failed (P2.10s; ADR 0080 point 4): one entry a UTC day in the owner's
 * inbox, however many fail, so they know to check the mail settings. It names no visitor: the address is forgotten.
 * The dedupe key holds only while the entry exists, and dismissing deletes it (P2.27b), so web also remembers the day
 * it sent one, decided before the first await: a dismissed notice stays gone until the next UTC day or a restart.
 * A failed insert forgets the day, so the next failure tries again.
 */
export async function sendInviteMailFailed(owner: Did, now: Date, deadline: AbortSignal): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  if (day === inviteNoticeDay) return;
  inviteNoticeDay = day;
  try {
    const sent = await services().notifications.send(
      owner,
      { reason: "invite_mail_failed", dedupeKey: `invite_mail_failed:${day}` },
      deadline,
    );
    if (!sent.ok) throw new Error(sent.error);
  } catch (error) {
    inviteNoticeDay = "";
    throw error;
  }
}

/** Dismissing the banner says the member has seen the change, so its entry goes too. */
export function withdrawPrivacyNotice(did: Did, version: string, deadline: AbortSignal): Promise<void> {
  return services().notifications.withdraw(did, noticeKey(version), deadline);
}
