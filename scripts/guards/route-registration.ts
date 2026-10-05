// Guard (P1.04q; P1.04 route_registration_guard): routes are registered only through the server kit, so every route
// passes the kit's checks (host, method, content type, deadline, rate-limit policy). Outside the two kit files,
// nothing may call `app.<verb>(` or import Hono, which is the only way to build a router that skips them.
// Lexical on purpose, and no guard-allow: a route that needs something the kit lacks is a change to the kit.
import { type Finding, PRODUCT_DIRS, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

export const SCANNED_DIRS = PRODUCT_DIRS;
export const KIT_FILES = ["shared/http/server.ts", "shared/http/routes.ts"];
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
  if (KIT_FILES.includes(file)) return [];
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (flagged(text)) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, sourceFiles(root, SCANNED_DIRS), RULE, scanRouteRegistration);
}
