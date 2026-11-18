// What server.ts reads of SvelteKit's build/server/manifest.js (kit 3.2.0 writes `manifest.client.stylesheets` there).
// package.json "imports" maps `#kit/manifest` to the build for Node and to this file for the type checker. Everything
// is optional: server.ts checks the value before it uses it.
export declare const manifest: { readonly client?: { readonly stylesheets?: unknown } } | undefined;
