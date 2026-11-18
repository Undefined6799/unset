// Guard (P1.04q; P1.04 route_registration_guard): routes are registered only through SvelteKit's file routes, so
// every route passes the gate (hooks.server.ts and its typed policy.ts). Nothing in product code may call
// `app.<verb>(` or import Hono, which is the only way to build a router that skips them. The Hono server kit's two
// files were exempt until P1.20k deleted them; nothing is exempt now. Lexical on purpose, and no guard-allow.
import { type Finding, PRODUCT_DIRS, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

const SCANNED_DIRS = PRODUCT_DIRS;
const RULE = "route-registration";

/**
 * Hono's registration methods, called on something named `app`: the `METHODS` list plus `all`, `on`, `use`, `route`,
 * `basePath` and `mount` (node_modules/hono/dist/router.js and hono-base.js, hono 4.13.9).
 */
const REGISTRATION = /\bapp\s*\.\s*(?:get|post|put|delete|options|patch|query|all|on|use|route|basePath|mount)\s*\(/;
const HONO_MODULE = /^(?:hono|@hono\/[^/]+)(?:\/|$)/;

function flagged(text: string): boolean {
  return REGISTRATION.test(text) || specifiersOn(text).some((s) => HONO_MODULE.test(s));
}

export function scanRouteRegistration(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (flagged(text)) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, sourceFiles(root, SCANNED_DIRS), RULE, scanRouteRegistration);
}
