// Outbound mail (ADR 0080): web's notice to the owner when a visitor asks for an invite.
export {
  createSmtpMailer,
  type Mail,
  type Mailer,
  type MailerOptions,
  type MailServer,
  parseSmtpUrl,
} from "./smtp.ts";
