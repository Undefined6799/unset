# 0080 — Invite requests: web mails the owner each visitor's address over SMTP

Status: Accepted by Alex, 2026-11-21 01:03Z, against 724bda1 (his line naming that head, given after it was reviewed;
merged as 7f06e16). This status paragraph, the index row and the ADR 0001 acceptance line were added afterwards. Book
step P2.10r. Alex asked on 2026-11-20 at 21:19Z for a "request an invite" feature that "could send me an email", so he
can send the invite by email, and chose on 2026-11-20 at 21:23Z that the mail to him carries the visitor's address.

## Context

Sign-up is invite only: `/join` works only from an invite link, and a visitor with no invite has no next step. Alex
wants visitors to be able to ask. Until now the web app sent no mail at all; only the PDS sends account mail, through
Resend (ADR 0065). So this is web's first outbound connection that is not HTTP, its first mail secret, and a new piece
of personal data: the email address of a visitor who is not a member.

## Decision

1. **The page.** `/request-invite` asks for one email address and the two confirmations sign-up asks for (the minimum
   age, and the invite-country rule while `INVITE_COUNTRY_RULE` is on). Nothing else. It runs no script and is never
   indexed. The sign-in page and a bare `/join` link to it; the limited-page card of ADR 0078 adds a "Sign up" button
   to it once that card exists.
2. **One mail, to the owner only.** Each accepted request sends one plain-text mail to the address in
   `INVITE_REQUEST_TO`, naming the visitor's address, with that address as Reply-To. Mail never goes to the address
   a visitor types, so the form cannot be used to send mail to anyone else. The owner makes the invite at `/invite`
   and sends the link from their own mailbox.
3. **No copy kept.** The address is parsed once (`domains/identity` `parseRequesterEmail`: ASCII dot-atom, a dotted
   host, 254 characters at most, no quote, space or line break). Web remembers, in its own memory only, a keyed hash
   of each accepted address for 30 days (key drawn at boot), so the same address asks once per 30 days; a restart
   forgets them. No address reaches the database, the logs or the disk. Logs carry only `invite.request_received`
   (`kind` first, repeat or trap) and `invite.request_mail_failed`.
4. **Abuse without an outside service.** No captcha. A POST counts against `inviteRequest` in
   `interfaces/web/src/lib/server/limits.ts`: 3 an hour per address (when the edge names the client) and 20 a day for
   the whole site, which bounds the owner's inbox and the provider's quota; the edge's `app_burst` and `app_global`
   zones still apply. A repeat, a filled hidden trap field and a first ask all answer the same, so the page never
   says whether an address asked before, not even by how long it takes: the visitor is answered at once in every
   case and the mail is sent after the answer, under its own 20 s deadline; a graceful stop waits for a send under
   way (one close hook, at most the drain's 5 s per hook). A failed mail is logged
   (`invite.request_mail_failed`, no address) and the address forgotten, so asking again sends again; the visitor is
   not told, since telling them would differ from a repeat. The CSRF gate and the 1 KiB body cap apply as on every
   form.
5. **The transport.** `infrastructure/email` is the one adapter that imports nodemailer (dependency-cruiser
   `vendor-sdk-one-adapter`). Always encrypted before the login, as ADR 0065's rule for the PDS: an `smtps:` URL is
   TLS from the first byte, an `smtp:` URL must upgrade with STARTTLS (nodemailer `requireTLS`) or nothing is sent;
   TLS 1.2 or later, the system trust store. So a later EU sender on port 587 is a URL change. Each wait (connect,
   greeting, idle) is 8 s inside the send's 20 s deadline; nodemailer reads no file or URL and writes no log. The
   server is a fixed host from config, never from a request, so this is not caller-influenced egress and does not go
   through net-guard.
6. **Off by default.** `INVITE_REQUESTS` is `off` unless set; then the page says requests are closed and no mail
   setting is read. On, boot refuses unless `INVITE_REQUEST_SMTP_URL` (a secret file, an `smtps:` or `smtp:` URL
   holding the provider's key), `INVITE_REQUEST_TO` (a secret file, so the owner's address is never in the checkout or
   in `docker inspect`) and `INVITE_REQUEST_FROM` are all valid. `shared/config` gains `optionalSecretFile` for the
   two files. A mail key for web should be its own Resend key with sending rights only, not the PDS's.

## Dependency (ADR 0057)

nodemailer 10.5.0 (MIT-0), published 2026-11-10, past the 7-day age; it has no dependencies of its own and ships its
own types. It is the established SMTP client for Node (Node has none built in), on npm since 2011 and kept up by its
author (npm `time.created`, 2011-01-21); 10.6.0 and 10.6.1 were under 7 days old. `npm audit` lists nothing for it.
The PDS image's older nodemailer 6.10.1 (`.github/trivyignore.pds.yaml`) is a separate copy and is not affected.

## Alternatives

- **A ping with no address, and an owner-only list in the app.** Resend would see nothing about the visitor, but web
  would store the address and need an owner role it does not have. Alex chose the address in the mail.
- **Resend's HTTP API with `fetch`.** No new package, but it ties web to Resend's API, where SMTP keeps the provider a
  setting (ADR 0065 point 1 chose SMTP for the PDS for the same reason).
- **Storing requests in Postgres.** Survives restarts, but keeps personal data in a table with erasure and export
  duties for a feature that needs none of it.

## Consequences

- The visitor's address, the subject and the text go to Resend in the United States, which keeps them 30 days (ADR
  0065 point 2). The privacy notice and the RoPA need a line for invite requests; that text is Alex's to approve and is
  not in this change.
- Nothing to erase or export on our side: we keep no address. A visitor who asks the owner to delete their request
  is answered from the owner's mailbox, and Resend's copy ends after 30 days.
- A restart lets an address ask again; the site-wide 20 a day still bounds the mail.
- 20 junk requests a day exhaust the site-wide bucket and refuse real visitors until it refills; acceptable while
  nothing links the page from outside, and the number is one line to change.
- Turning it on needs the two secret files on the server, by Alex's hand, and their mounts in the compose file; the
  runbook says how. Until then staging shows "Invite requests are closed for now."

## Compliance

- `tests/integration/email/smtp.test.ts`: the real adapter against a TLS SMTP server on loopback (implicit TLS,
  STARTTLS, no login when STARTTLS is missing, untrusted certificate, refused login, deadline).
- `tests/integration/web/public/request-invite.test.ts`: on the built server, one mail to the owner with Reply-To, a
  repeat mails nothing, bad input, a missing tick and the trap send nothing, a cross-site POST is refused, the fourth
  request from one address is refused, no address in any log line, the closed page, a failed mail, and a first ask,
  a repeat and the trap answering well inside a second while the mail server never answers, and a mail under way
  still sent when web is stopped.
- `interfaces/web/src/lib/server/limits.budget.test.ts`: normal use fits inside `inviteRequest`, a flood does not.
