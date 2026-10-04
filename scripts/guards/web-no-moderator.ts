// Guard: nothing moderator- or admin-shaped is reachable from the public web surface (PLAN.md §5.7).
// Lexical on purpose: a moderator path or pds-admin verb in a comment still counts; reword it.
// No guard-allow. dependency-cruiser's web-not-admin rule covers resolved imports as well.
import { posix } from "node:path";
import { type Finding, PRODUCT_DIRS, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

export const SCANNED_DIRS = PRODUCT_DIRS;
const RULE = "web-no-moderator";
const WEB_PREFIXES = ["apps/web/", "interfaces/http/"];

const MODERATOR_PATH = /^\/(admin|mod|moderat\w*|staff|ops|internal)(\/|$)/;
const ADMIN_MODULE = /^@unset\/admin(\/|$)|^@simplewebauthn\/|(^|\/)(apps|interfaces)\/admin(\/|$)/;
// pds-admin verbs other than invite.issue (P3.16, P3.16a hold.*, P3.16c preserve.*, P3.16d account.* and pds.health).
const PDS_ADMIN_VERB =
  /^(takedown|reinstate|account\.\w+|handle\.rename|hold\.\w+|preserve\.\w+|pds\.health|signup\.(open|close)|limits\.raise|lookup\.\w+|pii\.\w+)$/;

function stringLiterals(line: string): string[] {
  return [...line.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2] ?? "");
}

/** A relative specifier is resolved against the importing file, so `../admin/x` from interfaces/http is caught. */
function resolved(file: string, specifier: string): string {
  return specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), specifier)) : specifier;
}

function flagged(file: string, text: string): boolean {
  if (specifiersOn(text).some((s) => ADMIN_MODULE.test(resolved(file, s)))) return true;
  return stringLiterals(text).some((s) => MODERATOR_PATH.test(s) || PDS_ADMIN_VERB.test(s));
}

export function scanWebNoModerator(file: string, source: string): Finding[] {
  if (!WEB_PREFIXES.some((prefix) => file.startsWith(prefix))) return [];
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (flagged(file, text)) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, sourceFiles(root, SCANNED_DIRS), RULE, scanWebNoModerator);
}
