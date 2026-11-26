import { definePolicy } from "../../../lib/server/policy.ts";

// The chat icon's number (ADR 0115): a signed-in member the app gate lets in; it reads only.
export const policy = definePolicy({ group: "static", limit: "default", session: "required" });
