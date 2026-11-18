// Route parameter matchers (kit 3.2.0: one params module exporting `params` from defineParams; a function returns the
// value or undefined, node_modules/@sveltejs/kit/src/exports/params/public.d.ts).
// `legal`: the documents a /legal/<name> path may name (P2.15); any other name matches no route, so it is a 404.
import { defineParams } from "@sveltejs/kit/params";

const LEGAL = ["terms", "privacy", "domains"] as const;

export const params = defineParams({
  legal: (param: string) => LEGAL.find((name) => name === param),
});
