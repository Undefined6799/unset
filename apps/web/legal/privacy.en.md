---
version: 2026-10-17
---

# Privacy notice

<!-- P1 -->

## Who we are

The operator of unset.sh decides why this notice's personal information is used. The operator's legal name is not in this repository. Quebec's Act respecting the protection of personal information in the private sector, section 3.1, says an enterprise publishes the title and contact information of the person in charge of protecting personal information. A lawyer has not confirmed how that applies here. That person is {{privacyOfficerTitle}}, at {{privacyOfficerContact}}. Who holds the role is kept in the operator's own records, not on this page.

<!-- P2 -->

## What we hold

We hold your account DID, session records, drafts, invites, sealed sign-in tokens and onboarding timestamps. We never hold your password. You type a password only on the sign-in server, {{pdsHost}}.

<!-- P3 -->

## Addresses and browsers

We do not store IP addresses or browser details. From Phase 5, the connection data of each upload is kept, encrypted so that we cannot read it, for at most a few minutes while the check runs. It is destroyed at once when the check is clear, and kept with a legal hold only when the upload matches known abuse material. Rate limiting uses a short-lived in-memory hash of the address. That hash is never written down.

<!-- P4 -->

## Who else receives it

The Canadian Centre for Child Protection receives fingerprints only, never the photo or video. The hosting provider is named in Phase 5. When posting opens, automated review of posts and comments you submit for publication runs on our own servers and sends nothing to another company.

<!-- P5 -->

## How long we keep it

An unpublished profile draft, its text, sections and draft images, is deleted whole 30 days after your last edit. Unattached draft images expire after 30 days. Draft images are part of your export.

| What | How long |
| --- | --- |
| Account, profile and onboarding timestamps | Until the account is deleted, then erased, including from backups within 30 days |
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

<!-- P7 -->

## Federation

Public profiles and posts are copied by relays and by other apps. We cannot erase every copy.

<!-- P8 -->

## Contact

{{privacyOfficerTitle}}: {{privacyOfficerContact}}. Support: {{supportEmail}}. See also [our domains](/legal/domains).

## Changes

- 2026-10-17: First placeholder. Not reviewed by a lawyer. Not legal advice.
