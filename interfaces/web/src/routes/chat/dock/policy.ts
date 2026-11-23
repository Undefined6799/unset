import { definePolicy } from "../../../lib/server/policy.ts";

// The chat box's ticket (ADR 0115): a signed-in member the app gate lets in, a form post of one one-time value.
export const policy = definePolicy({ group: "static", limit: "default", session: "required", maxBody: 256 });
