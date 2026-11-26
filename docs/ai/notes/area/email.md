---
id: email
type: area
status: current
areas: ["[[email]]"]
summary: "Hub for infrastructure/email: the one SMTP adapter, used to mail the owner an invite request."
code: [infrastructure/email/index.ts, infrastructure/email/smtp.ts, infrastructure/email/package.json, interfaces/web/src/lib/server/compose.ts, interfaces/web/src/lib/server/config.ts, interfaces/web/src/lib/server/invite-requests.ts]
sources: []
importance: normal
related: ["[[web]]", "[[config]]", "[[net-guard]]"]
replaced_by: null
tags: [area, email]
checked: 2026-11-26
---
# email

**What it owns.** Outbound SMTP for the web process (ADR 0080, P2.10r). This folder is the one
adapter that imports nodemailer (`scripts/lint/.dependency-cruiser.cjs`, `vendor-sdk-one-adapter`;
nodemailer 10.5.0 in `infrastructure/email/package.json`). `index.ts` exports `parseSmtpUrl`,
`createSmtpMailer` and the `Mail`, `Mailer`, `MailerOptions` and `MailServer` types.

**The server URL.** `parseSmtpUrl` (`smtp.ts`) reads `smtps://user:pass@host` (implicit TLS, port
465 when the port is absent) or `smtp://user:pass@host` (no implicit TLS, port 587 when absent).
The user and the password are required and percent-decoded. An empty host, a path, a query, a
fragment, another scheme, or a string that does not parse is null.

**Who builds it.** `interfaces/web/src/lib/server/config.ts` leaves invite requests off unless
`INVITE_REQUESTS` is `on`. On, boot requires `INVITE_REQUEST_SMTP_URL` (optional secret file, at
least 16 bytes, accepted only when `parseSmtpUrl` returns a server), `INVITE_REQUEST_TO` (optional
secret file, at least 6 bytes, `parseRequesterEmail`) and `INVITE_REQUEST_FROM`
(`parseRequesterEmail`). A secret file is the file named by `<KEY>_FILE`
(`shared/config/schema.ts`). `compose.ts` `inviteRequestsOf` parses that URL and calls
`createSmtpMailer` with `from` and an 8 s timeout on connect, greeting and socket
(`MAIL_TIMEOUT_MS`).

**The one product send.** `interfaces/web/src/routes/request-invite/+page.server.ts` calls
`notifyOwner` (`invite-requests.ts`): one plain-text message to the owner address, with the
visitor's address as Reply-To. `send` returns `sent` or `failed` and does not throw. `sent` means
`accepted` is non-empty and `rejected` is empty. The route passes a 20 s `AbortSignal` as the
deadline. `createSmtpMailer` sets `disableFileAccess`, `disableUrlAccess` and `logger: false`, TLS
`minVersion` `TLSv1.2`, `secure` when the scheme is `smtps:`, and `requireTLS` when it is `smtp:`.
`ca` is only for a test server; with none, the transport is given no extra trust anchors.

**Egress.** The SMTP host is the host in that config URL, not a host taken from the request
(`smtp.ts`). The send does not go through [[net-guard]]. `infrastructure/net-guard/src/policies.ts`
names no mail policy.

**Links.** [[web]], [[config]], [[net-guard]]. ADR 0080
(`docs/human/decisions/0080-invite-requests-mail-the-owner.md`).
