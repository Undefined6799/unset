// The chat page the door serves on unset.cc (ADR 0099 decision 1): apps/chat's Vite build, read once at start. The
// document is served at the door's page paths; every built file at /assets/<name>, its name content-hashed by Vite, so
// it is cached for good. Only the kinds the page ships are served, each with its one type; any other file in the
// build stops the start. The page's CSP allows scripts, styles and fonts from /assets/ only, WebAssembly compilation
// for the key store ('wasm-unsafe-eval', CSP3 https://www.w3.org/TR/CSP3/#wasm-integration; the rust-crypto module of
// @matrix-org/matrix-sdk-crypto-wasm 18.9.2 is compiled with WebAssembly.instantiateStreaming, index.mjs:59), fetches
// to its own origin only (the door, and the homeserver behind the edge at /_matrix/client, ADR 0093 decision 6), and
// one Trusted Types policy, the one Svelte 5.57.3 creates when it loads (ADR 0054 decision 4).
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

export type PageFile = { readonly body: Uint8Array; readonly type: string };
export type ChatPage = { readonly html: string; readonly files: ReadonlyMap<string, PageFile> };

/** Where the page's built files are served. */
export const ASSETS = "/assets/";

const TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

/** apps/chat/dist/page as Vite writes it: index.html and a flat assets/ folder. Throws on anything else. */
export function loadChatPage(dir: string): ChatPage {
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const files = new Map<string, PageFile>();
  for (const name of readdirSync(join(dir, "assets"))) {
    const type = TYPES[extname(name)];
    if (type === undefined) throw new Error(`the chat page holds a file it never serves: ${name}`);
    files.set(`${ASSETS}${name}`, { body: new Uint8Array(readFileSync(join(dir, "assets", name))), type });
  }
  return { html, files };
}

export const pageCsp = (origin: string): string =>
  [
    "default-src 'none'",
    `script-src ${origin}${ASSETS} 'wasm-unsafe-eval'`,
    `style-src ${origin}${ASSETS}`,
    `font-src ${origin}${ASSETS}`,
    "img-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types svelte-trusted-html",
  ].join("; ");
