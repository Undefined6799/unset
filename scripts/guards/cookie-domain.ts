// Guard: no cookie is ever scoped with a Domain attribute.
// Session cookies are `__Host-` (host-only by definition); a Domain cookie on
// the app would also reach chat.<app domain> and any other subdomain
// (PLAN.md §5.2, domains table). No guard-allow: there is no acceptable exception.
import { type Finding, isTestFile, PRODUCT_DIRS, scanFiles, sourceFiles } from "./files.ts";

export const SCANNED_DIRS = PRODUCT_DIRS;
const RULE = "cookie-domain";

const DOMAIN_ATTR = /;\s*domain\s*=/i; // "...; Domain=example.com" in a Set-Cookie string
// A domain option near cookie code: `domain: x`, `"domain": x`, shorthand `{ domain }`, or a built-up "Domain=".
const DOMAIN_OPTION = /\bdomain\s*[:,}]|["'`]domain["'`]\s*:|\bdomain\s*=/i;
const COOKIE_CONTEXT = /cookie/i;
const NEAR = 5;

export function scanCookieDomain(file: string, source: string): Finding[] {
  if (isTestFile(file)) return [];
  const lines = source.split("\n");
  const findings: Finding[] = [];
  lines.forEach((text, i) => {
    // An options-object `domain:` only counts near cookie code, so unrelated
    // fields (e.g. a config's handle domain) are not flagged.
    const near = lines.slice(Math.max(0, i - NEAR), i + NEAR + 1).join("\n");
    if (DOMAIN_ATTR.test(text) || (DOMAIN_OPTION.test(text) && COOKIE_CONTEXT.test(near))) {
      findings.push({ file, line: i + 1, rule: RULE, text });
    }
  });
  return findings;
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, sourceFiles(root, SCANNED_DIRS), RULE, scanCookieDomain);
}
