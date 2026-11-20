// What server.ts reads of SvelteKit's build/server/manifest.js: kit 3.2.0 lists each node there as a function that loads
// its module, and the root layout's (node 0) exports the stylesheets it links. package.json "imports" maps
// `#kit/manifest` to the build for Node and to this file for the type checker. Everything is optional: server.ts checks
// the value before it uses it.
export declare const manifest:
  | { readonly nodes?: readonly (() => Promise<{ readonly stylesheets?: unknown }>)[] }
  | undefined;
