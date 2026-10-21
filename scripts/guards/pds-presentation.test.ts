import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { scanAll } from "./pds-presentation.ts";

const roots: string[] = [];
function tree(file: string, text: string): string {
  const root = mkdtempSync(join(tmpdir(), "pds-presentation-"));
  roots.push(root);
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("rejects_network_storage_and_session_ownership", () => {
  for (const source of [
    'fetch("/x")',
    'globalThis.fetch("/x")',
    "const request = fetch;",
    "const request = (fetch as typeof fetch);",
    "new XMLHttpRequest()",
    'new WebSocket("wss://x")',
    'new EventSource("/x")',
    'window.localStorage.getItem("session")',
    "sessionStorage.clear()",
    'indexedDB.open("x")',
    'document.cookie = "x=y"',
    "window.document.cookie",
    'globalThis["document"]["cookie"]',
    'const c = document["cookie"]',
    'navigator.sendBeacon("/x")',
    "function useSession() { return null }",
    "const createSession = () => null",
    "function resolveHandle() {}",
    "createBrowserRouter([])",
    "export const sessionStore = {}",
    "const x = ;",
  ]) {
    expect(scanAll(tree("apps/pds/src/view.tsx", source)).length, source).toBeGreaterThan(0);
  }
});

test("rejects_server_entry_roles", () => {
  for (const file of [
    "apps/pds/server.ts",
    "apps/pds/src/start.ts",
    "apps/pds/bin/cli.mjs",
    "apps/pds/src/session.ts",
  ]) {
    expect(scanAll(tree(file, "export {};")).length, file).toBeGreaterThan(0);
  }
  for (const pkg of [
    { bin: "cli.js" },
    { main: "server.js" },
    { scripts: { start: "node server.js" } },
    { scripts: { serve: "vite" } },
  ]) {
    expect(scanAll(tree("apps/pds/package.json", JSON.stringify(pkg))).length).toBeGreaterThan(0);
  }
});

test("accepts_native_presentation_contracts", () => {
  const source = `import type { SafeHref } from "@unset/shared-ui/presentation";
    type Account = { accountLabel: string; href: SafeHref; avatar: string; current: boolean;
      children: React.ReactNode; onSignIn: () => void; nativeControls: React.ReactNode };
    export function View(props: Account) { return <button onClick={props.onSignIn}>{props.accountLabel}{props.children}{props.nativeControls}</button> }
    // fetch('comment') and document.cookie are prose.
    const label = "session storage cookie";`;
  expect(scanAll(tree("apps/pds/src/view.tsx", source))).toEqual([]);
  expect(scanAll(tree("apps/pds/src/view.test.tsx", 'fetch("/fixture")'))).toEqual([]);
  expect(scanAll(tree("apps/pds/package.json", JSON.stringify({ scripts: { build: "tsc -b" } })))).toEqual([]);
});

test("repository_pds_presentation_ownership", () => {
  expect(scanAll(join(import.meta.dirname, "../.."))).toEqual([]);
});
