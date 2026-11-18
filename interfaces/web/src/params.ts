// Route parameter matchers (kit 3.2.0: one params module exporting `params` from defineParams; a function returns the
// value or undefined, node_modules/@sveltejs/kit/src/exports/params/public.d.ts).
// `legal`: the documents a /legal/<name> path may name (P2.15); any other name matches no route, so it is a 404.
// `did`: a segment with DID syntax (https://atproto.com/specs/did, "DID Syntax"), so the member page /<DID> never
// shadows a fixed path. SvelteKit's client router knows only page routes: without it, a link to /me (a +server.ts
// redirect) matched /[did] with did "me" and showed not found in place of following the server's 303 (P1.20k, staging
// 2026-11-18). The shape only: the page's load still parses the DID with parseDid, which decides.
import { defineParams } from "@sveltejs/kit/params";

const LEGAL = ["terms", "privacy", "domains"] as const;
const DID_SYNTAX = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const DID_MAX_LENGTH = 2048;

export const params = defineParams({
  legal: (param: string) => LEGAL.find((name) => name === param),
  did: (param: string) => (param.length <= DID_MAX_LENGTH && DID_SYNTAX.test(param) ? param : undefined),
});
