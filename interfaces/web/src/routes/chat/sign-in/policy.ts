import { definePolicy } from "../../../lib/server/policy.ts";

// The unset.sh half of the unset.cc sign-in hop (build step 5; ADR 0093 decision 3): a signed-in member only, so a
// visitor signs in first and comes back here (with no one-time value, so the door starts again). The app gate is run
// by the route (chat-sign-in.ts admit), which also lets in a member at signup's chat step (P6.17). It renders nothing:
// a redirect, no script.
export const policy = definePolicy({ group: "static", limit: "default", session: "onboarding" });
