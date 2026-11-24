import { definePolicy } from "../../lib/server/policy.ts";

// The page an invite link opens (book P2.10): anyone may read it, and it runs no script. The session is read only to
// tell a signed-in visitor the invite is for someone else; a page rendered for a member is private (hooks.server.ts).
// Its one form starts a sign-up at our PDS and counts against the sign-in limit (10 a minute per address).
export const policy = definePolicy({
  group: "public",
  client: false,
  limit: "default",
  writeLimit: "login",
  session: "optional",
  maxBody: 256,
});
