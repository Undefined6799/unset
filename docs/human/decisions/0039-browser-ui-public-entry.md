# 0039 — Browser condition for the public UI entry

Status: Proposed (implementation ready for review)

## Context

The editor needs the existing Iconoir renderer and seven registered drawings. Importing the full registry
exceeds the island budget because it shares a chunk with other consumers. Importing the server UI barrel makes
Header and ThemePicker islands eager. The existing pure presentation entry avoids both, but importing its subpath
from an app fails the repository's public-index boundary.

## Decision

Keep app imports through `@unset/shared-ui`. Its browser export resolves to the existing `presentation.ts`;
Node/SSR and type declarations retain `index.ts`. Export the drawing renderer and selected generated icons
through both entries. No guard is relaxed and no component, dependency, SVG source or icon registry changes.

## Alternatives

- Import the presentation subpath directly: builds correctly but violates the public-index boundary.
- Keep the server barrel in the browser: makes unrelated islands eager and fails the lazy-chunk check.
- Clone server-rendered SVG into controls: adds a DOM transport mechanism when a package condition suffices.

## Consequences

Browser consumers can use the pure presentation API; server screens retain the complete component API. Future
browser exports must be added to both entries. Server-only shell components are not browser exports. The actual
browser/SSR builds and existing lazy-island and no-icon-map checks verify the boundary.

## Compliance

D8 records the export change. Vite 8.3.4 selects browser conditions for clients and excludes them for ordinary
SSR (`node_modules/vite/dist/node/chunks/node.js`, DEFAULT_CLIENT_CONDITIONS and resolve conditions).
DC-2 public imports and the existing CSP/Trusted Types integration are preserved.
