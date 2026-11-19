# 0065 — Resend sends account mail for now, with its data in the United States

Status: Proposed (awaiting Alex). Steps P2.25 (step 2a) and P2.15 (the RoPA and the notice). Alex, 2026-11-19
02:22:46Z: "lets go us for now and we can explore alternative later".

## Context
Our PDS sends its own account mail over SMTP: email confirmation, password reset, sign-in confirmation (2FA), email
change, account deletion and PLC update codes (`@atproto/pds` 0.5.51 `dist/mailer/index.js` and
`dist/mailer/templates/`), and moderation mail, the text a moderator writes to a member through
`com.atproto.admin.sendEmail` (`dist/mailer/moderation.js`). The web app sends no mail. Staging already sends
through Resend: `PDS_EMAIL_SMTP_URL` is `smtps://resend:<key>@smtp.resend.com:465` (runbook
`dev-stack-secrets.md`), and the sender is `noreply@staging.unset.sh`. No record chose Resend: the runbook named it
and the RoPA row still said "not chosen yet".

Alex's answer 21 (2026-10-03, ADR 0001 log and plan section 6) asked for "a paid email sending service in Canada or
the EU". Resend does not meet the hosting half. Its GDPR page (resend.com/security/gdpr, read 2026-11-19) says
"Resend stores customer data in the United States" and "there is no setting today that moves stored data to the EU";
its regions page (resend.com/docs/dashboard/domains/regions, read 2026-11-19) says the region chooses only where mail
leaves from, and "All account data, including email metadata, logs, and API records, is stored in the United States
regardless of the sending region you select". Transfers out of the EEA rest on the EU Standard Contractual Clauses,
and Resend is in the EU-U.S. Data Privacy Framework; a GDPR Article 28 DPA is in force for every account.

## Decision
1. **Resend is our transactional email sender for now, in staging and production.** This drops the "in Canada or
   the EU" part of answer 21. The PDS reaches it only by SMTP over implicit TLS (preflight C11, C19); no Resend SDK or
   API key with more than sending rights is used.
2. **What Resend sees:** each recipient's email address, the subject, and the message, which holds a short-lived code
   and, in password reset and sign-in confirmation mail, the member's handle; for moderation mail, the moderator's
   text to that member. It keeps email and log data for 30 days on the Free, Pro and Scale plans (GDPR page), in
   the US. Message content is stored by default; Resend turns that
   off only on request, for teams on Pro or Scale for at least a month with over 3,000 emails sent, as a paid add-on
   (resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend, read 2026-11-19). We do not
   buy it now.
3. **What Resend never sees:** passwords, DIDs, profile content, sections, drafts, invites, sessions or anything a
   member posts. Our rule that no outside company sees members' content still holds: account mail is not content.
4. **The key** is a sending-only key, kept only in `pds.env` on the host (runbook `dev-stack-secrets.md`), never in
   the repository, a log or a chat. Alex makes and rotates it.
5. **Members are told.** The privacy notice names Resend, the US and the 30 days in "Who else receives it", and the
   RoPA's SMTP provider row names it.

## Alternatives
- **An EU or Canadian sender now** (answer 21 as written), for example Scaleway Transactional Email. Keeps data out of
  the US, but staging already sends through Resend and no candidate's storage was checked tonight. Deferred, not
  rejected: it is the Open item below.
- **Resend with content storage turned off.** Only offered after a month on a paid plan and 3,000 emails, as an add-on;
  not reachable before the first testers. Can be asked for later.
- **Our own mail server.** No outside company, but deliverability to large providers needs reputation we do not have,
  and it is a new service to run and secure. Rejected for now.

## Consequences
- Members' addresses and codes sit in the US for up to 30 days, under US law, beside Ontario (PIPEDA) and GDPR duties.
- Changing sender later is one SMTP URL in `pds.env`, new DNS records and a notice line; no code depends on Resend.

## Compliance
- Preflight C11 and C19 (`deployment/preflight/checks/pds.ts`, `settings.ts`): both mail URLs are smtps, or smtp with
  `requireTLS=true`, never Mailpit, and each has its from address.
- The RoPA's SMTP provider row and the privacy notice's "Who else receives it" name Resend, the US and 30 days.
- `scripts/docs/compliance.test.ts` checks the RoPA row's lawful basis.

## Open
- **Revisit an EU or Canadian sender** before the first real member, and at the latest before public launch. Scaleway
  Transactional Email (France; `smtp.tem.scaleway.com`, port 465) is one candidate; where it stores data was not
  verified.
- The DNS records for the production sender (`unset.sh`) are made when production is, coordinated with the move of
  `unset.sh` to deSEC.
