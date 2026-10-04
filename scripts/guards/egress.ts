// Guard: all caller-influenced outbound HTTP goes through infrastructure/net-guard.
// The prototype grew four copies of private-IP classification and an SSRF via
// redirects + DNS rebinding before this was centralised (PLAN.md §2 rule 13).
import { pathToFileURL } from "node:url";
import { allowed, type Finding, read, report, sourceFiles } from "./files.ts";

export const SCANNED_DIRS = ["apps", "interfaces", "domains", "infrastructure", "shared"] as const;
const EXEMPT_PREFIX = "infrastructure/net-guard/";

// fetch( whose first argument is not a plain string literal (template literals count as dynamic).
const DYNAMIC_FETCH = /\bfetch\s*\(\s*(?!["'][^"'`]*["']\s*[,)])/;
// Raw HTTP clients that bypass the guard entirely.
const RAW_CLIENT =
  /\bfrom\s+["'](?:undici|node:https?|https?|axios|got|node-fetch)["']|\brequire\(\s*["'](?:undici|node:https?|https?)["']\s*\)/;

export function scanEgress(file: string, source: string): Finding[] {
  if (file.startsWith(EXEMPT_PREFIX) || /\.test\.[cm]?[jt]sx?$/.test(file)) return [];
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (allowed(text, "egress")) return;
    if (DYNAMIC_FETCH.test(text)) findings.push({ file, line: i + 1, rule: "egress", text });
    else if (RAW_CLIENT.test(text)) findings.push({ file, line: i + 1, rule: "egress", text });
  });
  return findings;
}

export function main(root = process.cwd()): number {
  const findings = sourceFiles(root, SCANNED_DIRS).flatMap((f) => scanEgress(f, read(root, f)));
  return report(
    findings,
    "Use the net-guard egress client for outbound HTTP. A constant, allowlisted URL may carry `// guard-allow: egress` with a reason.",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
