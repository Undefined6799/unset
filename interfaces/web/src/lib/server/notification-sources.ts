// What web sends into the notification inbox (P2.27, ADR 0079). Each source is one `notify` call through compose's
// notifications service, the same way any later source will send; nothing here reaches the inbox's rows directly.
import { type Did, requireOnboarded } from "@unset/domains-identity";
import type { Notification } from "@unset/domains-notifications";
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

/** Dismissing the banner says the member has seen the change, so its entry goes too. */
export function withdrawPrivacyNotice(did: Did, version: string, deadline: AbortSignal): Promise<void> {
  return services().notifications.withdraw(did, noticeKey(version), deadline);
}
