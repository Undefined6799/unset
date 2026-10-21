# Paired PDS frontend build

`source.lock.json` fixes the official PDS image, Node builder, upstream source archive and lockfile. Its `linux/amd64` platform is the native CI target. The exact schema, Dockerfile interface and clean-checkout verifier command are in [the checker contract](../../scripts/ci/pds-ui/README.md); updating any source or package version requires reviewing that contract with this recipe.

The source is `bluesky-social/atproto` revision `a7c8604d876a200a1e4fa4aec83d4189ac4f1c12`. Its archive SHA256 is `706ab7fa7410a406ed3d4e67837662e21ade7d4be4f6a33a491703c0805b0555`; its `pnpm-lock.yaml` SHA256 is `d56b93f5fe51bbad31919df7039be088e9e61f80f57017a188f02e35f2ca16f8`. The official image's installed package tuple is `@atproto/pds@0.5.37`, `@atproto/oauth-provider@0.23.1`, `@atproto/oauth-provider-ui@0.10.5`. The builder checks these inputs before installing dependencies.

The Dockerfile builds only the UI and its supporting TypeScript projects with Node 26.10.0 and pnpm 11.11.0, using the frozen upstream lock and disabled install scripts. A scratch stage exports only the completed `dist`; the final stage replaces exactly the installed UI directory in the official image. The verifier compares the complete runtime Config and every effective filesystem entry outside that directory against the official base.

Upstream's pinned `rolldown-plugin-bundle-manifest` hashes intermediate chunks in `generateBundle`; six native manifest hashes do not match the final Vite output. After Vite succeeds, this recipe recomputes each manifest item's `sha256` from its final named file, preserves every other field and asset byte, and writes deterministic two-space JSON. The provider continues to consume its native manifest format. Source evidence: `packages/internal/rolldown-plugin-bundle-manifest/src/index.ts` and `packages/oauth/oauth-provider/src/router/assets/assets-manifest.ts` at the locked revision; see the [checker contract](../../scripts/ci/pds-ui/README.md) for the observed Vite 8.3.1 behavior.

This recipe creates a candidate for strict verification. Image admission, publication and deployment remain separate gates; native amd64 CI and the vulnerability scan must pass before release.

P2.24u consumes only v's selected scratch context, with repository-relative paths
and builder-only `UNSET_INPUTS_SHA256`. `build-inputs.json` names the fixed checker
policy; the empty canonical patch manifest is bootstrap only. A separately reviewed
check promotion must require the complete Devices cohort before styled admission.
No checkout, local dependencies, tests or docs are sent to the builder.

The builtins-only helper runs as `node build-ui.mjs -- prepare|configure|verify
INPUTS DIGEST SOURCE STATE [CONFIG]`. It observes every copied file before source
preparation and after build. It records original paths/types/modes/links/hashes,
plans every exact pinned patch before any write, and conserves all originals.
New outputs are limited to the seven locale catalogs, nine supporting TypeScript
output trees/buildinfo files, native dist assets, and bounded internal dependency
trees. Original routeTree.gen.ts and hydration-data.d.ts symlink remain unchanged.

Supplemental config and caches stay outside source. It retains upstream plugins,
four entries, base and native manifest, using the existing upstream UI tsconfig for
local compiler/resolver lookup. Exact public aliases and actual React/DOM19.3.0
module identities share the frozen upstream installation. The staged canonical
CSS scope helper retains repository paths; foundations load only when the exact
app entry is consumed. Only the two fixed source font URLs change in memory to
`/_unset/fonts/`; disk source bytes and every other token stay unchanged.

Global shared base CSS can affect retained native and portaled controls because
the provider serves every manifest stylesheet on every page. Native browser/cascade,
font/CSP and complete styled CSS acceptance remain pending. Cached host diagnostics
prove repeated bootstrap artifacts and a separate local-entry closure; they do not
prove frozen installation, Linux images, backend/Config equality or deployment.
Measured native CSS remains over the unchanged caps; no pruning or waiver applies.
