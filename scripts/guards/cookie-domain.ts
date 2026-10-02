// Guard: no cookie is ever scoped with a Domain attribute.
// Session cookies are `__Host-` (host-only by definition); a Domain cookie on
// the app would also reach chat.<app domain> and any other subdomain
// (PLAN.md §5.2, domains table).
import { pathToFileURL } from "node:url";
import { allowed, type Finding, read, report, sourceFiles } from "./files.ts";

export const SCANNED_DIRS = ["apps", "packages", "modules", "plugins"] as const;

const DOMAIN_ATTR = /;\s*domain\s*=/i; // "...; Domain=example.com" in a Set-Cookie string
const DOMAIN_OPTION = /\bdomain\s*:/i; // { domain: ... } in a cookie options object
const COOKIE_CONTEXT = /cookie/i;

export function scanCookieDomain(file: string, source: string): Finding[] {
  if (/\.test\.[cm]?[jt]sx?$/.test(file)) return [];
  const lines = source.split("\n");
  const findings: Finding[] = [];
  lines.forEach((text, i) => {
    if (allowed(text, "cookie-domain")) return;
    if (DOMAIN_ATTR.test(text)) {
      findings.push({ file, line: i + 1, rule: "cookie-domain", text });
      return;
    }
    // An options-object `domain:` only counts near cookie code, so unrelated
    // fields (e.g. a config's handle domain) are not flagged.
    const near = lines.slice(Math.max(0, i - 5), i + 6).join("\n");
    if (DOMAIN_OPTION.test(text) && COOKIE_CONTEXT.test(near)) {
      findings.push({ file, line: i + 1, rule: "cookie-domain", text });
    }
  });
  return findings;
}

export function main(root = process.cwd()): number {
  const findings = sourceFiles(root, SCANNED_DIRS).flatMap((f) => scanCookieDomain(f, read(root, f)));
  return report(findings, "Cookies must be host-only (`__Host-` prefix, no Domain attribute).");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
