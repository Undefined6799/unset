// ADR 0027: named ownership patterns, not a proof that arbitrary authentication logic is absent.
// SWC 1.16.18 parseSync: node_modules/@swc/core/index.{d.ts,js}; parser errors fail closed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "@swc/core";
import { type Finding, isTestFile, scanFiles, sourceFiles } from "./files.ts";

const RULE = "pds-presentation";
const GLOBAL_APIS = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "cookieStore",
]);
const OWNERS = new Set([
  "useSession",
  "useAuth",
  "useAccount",
  "createSession",
  "sessionStore",
  "authenticate",
  "resolveHandle",
  "createBrowserRouter",
  "createRouter",
]);
type Node = { type?: string; value?: string; span?: { start: number }; [key: string]: unknown };
const node = (value: unknown): Node => (value !== null && typeof value === "object" ? (value as Node) : {});
const name = (value: unknown): string => {
  const item = node(value);
  if (item.type === "Computed") return name(item.expression);
  if (item.type === "MemberExpression") return `${name(item.object)}.${name(item.property)}`;
  return item.value ?? "";
};

function forbiddenMember(item: Node): boolean {
  const object = name(item.object).replace(/^(?:(?:window|self|globalThis)(?:\.|$))+/, "");
  const property = name(item.property);
  return (
    (object === "" && GLOBAL_APIS.has(property)) ||
    (object === "document" && property === "cookie") ||
    (object === "navigator" && ["sendBeacon", "credentials", "serviceWorker"].includes(property))
  );
}

function forbidden(item: Node, parent: Node, key: string): boolean {
  if (item.type === "MemberExpression") return forbiddenMember(item);
  if (item.type !== "Identifier") return false;
  if (key !== "property" && key !== "key" && GLOBAL_APIS.has(name(item))) return true;
  if (!OWNERS.has(name(item))) return false;
  // Native callbacks/slots remain valid. Flag locally declared owners and router constructors.
  return (
    (parent.type === "VariableDeclarator" && key === "id") ||
    (["FunctionDeclaration", "ClassDeclaration"].includes(parent.type ?? "") && key === "identifier") ||
    (["CallExpression", "NewExpression"].includes(parent.type ?? "") && key === "callee")
  );
}

function walk(
  value: unknown,
  check: (item: Node, parent: Node, key: string) => void,
  parent: Node = {},
  key = "",
): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, check, parent, key);
    return;
  }
  const item = node(value);
  // Type declarations/annotations are not runtime; TS assertion expressions still contain runtime code.
  if (["typeAnnotation", "typeArguments", "typeParameters", "returnType"].includes(key)) return;
  if (["TsInterfaceDeclaration", "TsTypeAliasDeclaration"].includes(item.type ?? "")) return;
  check(item, parent, key);
  for (const [childKey, child] of Object.entries(item)) {
    if (child !== null && typeof child === "object") walk(child, check, item, childKey);
  }
}

function scan(file: string, source: string): Finding[] {
  const finding = (line: number, text: string): Finding => ({ file, line, rule: RULE, text });
  if (/(?:^|\/)(?:server|start|bin|api|routes?|auth|session|storage|sdk)(?:\/|\.[cm]?[jt]sx?$)/i.test(file)) {
    return [finding(1, "server/data/session role in presentation package")];
  }
  const out: Finding[] = [];
  const lines = new Set<number>();
  try {
    walk(parseSync(source, { syntax: "typescript", tsx: file.endsWith(".tsx") }), (item, parent, key) => {
      if (!forbidden(item, parent, key)) return;
      const line = Buffer.from(source)
        .subarray(0, (item.span?.start ?? 1) - 1)
        .toString()
        .split("\n").length;
      if (lines.has(line)) return;
      lines.add(line);
      out.push(finding(line, "network/storage/session ownership pattern"));
    });
  } catch {
    out.push(finding(1, "unparseable presentation source"));
  }

  return out;
}

/** Checks shipped PDS source and package roles. No suppressions; tests do not ship. Review/native tests
 * still establish ownership beyond the named global APIs, local owners, router calls and entry roles. */
export function scanAll(root: string): Finding[] {
  const findings = scanFiles(
    root,
    sourceFiles(root, ["apps/pds"]).filter((file) => !isTestFile(file)),
    RULE,
    scan,
  );
  const file = "apps/pds/package.json";
  if (!existsSync(join(root, file))) return findings;
  try {
    const pkg = JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, unknown>;
    const scripts = Object.keys((pkg.scripts ?? {}) as object);
    if (
      ["bin", "main"].some((key) => key in pkg) ||
      scripts.some((key) => /^(?:pre|post)?(?:start|serve|server|dev)(?::|$)/.test(key))
    ) {
      findings.push({ file, line: 1, rule: RULE, text: "server/start/bin package role" });
    }
  } catch {
    findings.push({ file, line: 1, rule: RULE, text: "unreadable presentation manifest" });
  }
  return findings;
}
