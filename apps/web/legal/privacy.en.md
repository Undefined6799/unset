---
version: 2026-11-19
---

# Privacy notice

<!-- P1 -->

## Who we are

The operator of unset.sh decides why this notice's personal information is used. The operator's legal name is not in this repository. Quebec's Act respecting the protection of personal information in the private sector, section 3.1, says an enterprise publishes the title and contact information of the person in charge of protecting personal information. A lawyer has not confirmed how that applies here. That person is {{privacyOfficerTitle}}, at {{privacyOfficerContact}}. Who holds the role is kept in the operator's own records, not on this page.

<!-- P2 -->

## What we hold

We hold your account DID, session records, drafts, invites, sealed sign-in tokens and onboarding timestamps. We never hold your password. You type a password only on the sign-in server, {{pdsHost}}. When your account is on our PDS, we also keep a copy of the public profile and sections you publish there, with your handle and your account's status, so your profile page loads from our own database. If you choose under Settings › Profile › Search and AI, we also keep whether search engines and AI search may show your public page, and the search title and description you typed. Both are off until you turn them on, and turning them off withdraws the choice.

<!-- P3 -->

## Addresses and browsers

We do not store IP addresses or browser details. From Phase 5, the connection data of each upload is kept, encrypted so that we cannot read it, for at most a few minutes while the check runs. It is destroyed at once when the check is clear, and kept with a legal hold only when the upload matches known abuse material. Rate limiting uses a short-lived in-memory hash of the address. That hash is never written down.

<!-- P4 -->

## Who else receives it

Resend, a company in the United States, sends the account emails from our sign-in server, such as confirmation and password reset codes. It receives your email address and those messages, and keeps them for 30 days in the United States. The Canadian Centre for Child Protection receives fingerprints only, never the photo or video. The hosting provider is named in Phase 5. When posting opens, automated review of posts and comments you submit for publication runs on our own servers and sends nothing to another company.

<!-- P5 -->

## How long we keep it

A picture you upload is kept only as the versions we make of it, never as the file you sent, and without its hidden data such as camera details or location. A picture no save uses is deleted 24 hours after upload. When the last card or entry using a picture is removed, our copies are deleted 7 days later. Your pictures are part of your export.

| What | How long |
| --- | --- |
| Account, profile and onboarding timestamps | Until the account is deleted, then erased, including from backups within 30 days |
| Copy of your public profile and sections | Until you delete the record, or the account is deleted, then erased, including from backups within 30 days. We keep only a keyed hash of your account identifier, so we never copy your profile again |
| Names you held under our domain | While the service runs. We never issue a name again once it was used, to you or anyone else, so we keep each name with no account identifier: as a keyed hash once that is built, and until then the name alone |
| Search and AI choices and search title and description | Until you turn them all off or the account is deleted, then erased, including from backups within 30 days |
| Sessions | Until you sign out, or 7 days idle, or 30 days at most |
| Sealed sign-in tokens | Until you sign out or the grant ends |
| Invites | Until the account is deleted |
| Edge logs | 3 days: status, route template and timing only. No address, path or query |
| Rate-limit hash | About a minute, in memory only, never written |
| Upload connection data | From Phase 5: minutes, while the check runs, then destroyed unless a legal hold applies |
| Abuse-material preservation | 21 days after notification today; one year once the later regime is in force. A lawyer has not confirmed this |
| Reports | 6 months after the case closes |
| Moderation decisions | 1 year after the case closes |
| Admin action log | 2 years. It may include the acting admin's private network address, never a user's |
| Admin security events | 1 year |
| Breach record | 24 months |
| Aggregate counts | 13 months, rounded, never tied to one person. No browser performance beacon |
| Operational health signals | The latest value only, never tied to a person |
| Backups | 30 days |

<!-- P6 -->

## Your rights

You can ask for a copy of the information we hold (an export), for erasure and for a correction. Raise it with us first, at {{privacyOfficerContact}}. You can complain to the [Office of the Privacy Commissioner of Canada](https://www.priv.gc.ca/en/report-a-concern/) and to [Quebec's Commission d'accès à l'information](https://www.cai.gouv.qc.ca/english/).

When you ask us to delete your account, we hide it at once and delete it 30 days later; until then you can change your mind. Deleting it yourself on the sign-in server, {{pdsHost}}, takes effect at once. Backups then age out within their 30 days.

<!-- P7 -->

## Federation

Public profiles and posts are copied by relays and by other apps. We cannot erase every copy. Your account identifier (DID) and every handle it has had are written to the public PLC directory, which keeps that history forever, even after your account is deleted. Nobody, including us, can remove it.

<!-- P8 -->

## Contact

{{privacyOfficerTitle}}: {{privacyOfficerContact}}. Support: {{supportEmail}}. See also [our domains](/legal/domains).

## Changes

- 2026-10-17: First placeholder. Not reviewed by a lawyer. Not legal advice.
- 2026-11-19: Added the copy of your public profile we keep when your account is on our PDS, the keyed hash we keep after erasure, your Search and AI choices, Resend, which sends our account emails from the United States, the names we never issue again, and the public PLC history of your identifier.
