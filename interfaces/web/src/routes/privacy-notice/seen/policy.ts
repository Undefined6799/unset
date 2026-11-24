import { definePolicy } from "../../../lib/server/policy.ts";

// The changed privacy notice banner's dismiss (P2.12b): a member's plain form, behind the session, the app gate, the
// one CSRF gate and the Origin check. 2 KB, as the theme form.
export const policy = definePolicy({
  group: "app",
  client: false,
  limit: "default",
  session: "required",
  maxBody: 2_048,
});
