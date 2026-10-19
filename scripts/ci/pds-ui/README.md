# Paired PDS frontend checks

P2.24b registers a build verification contract only. It does not admit a derived image to Compose, change vendor
image rules, publish an image, or alter a running PDS. `deployment/pds/Dockerfile` and `source.lock.json` arrive in
P2.24c. Discovery and the images workflow fail if only one exists or either violates this contract. Both absent
means explicitly no candidate; once present, verification cannot be skipped. `scan` requires the PDS job's success.

## Threats and trusted inputs

A compromised build could alter provider code, runtime configuration, permissions, links or ancestor directories;
forge manifest metadata; or hide changes behind archive ambiguity. Verification consumes actual immutable OCI
archives and actual frontend output. It never extracts an untrusted archive. Unknown archive types, extensions,
noncanonical/duplicate paths, escaping links, ancestor whiteouts, metadata/config changes and mismatching hashes
fail. Only timestamps are excluded from comparison. No running-container filesystem exceptions exist.

The trust roots are the reviewed source lock and a clean checkout's actual Git revision. The verifier checks blob
and uncompressed-layer digests, exact stored official layer prefix, complete Config and effective outside tree.
The only mutable path is the exact `uiDirectory` below; neither its parent package nor a glob is allowed. Added
ancestor directory records must preserve all metadata. UI output must contain regular files and match the installed
candidate bytes, including the native manifest. It must name exactly the four upstream entries and resolve every
manifest item/dynamic reference with a final-byte SHA256. Inline manifest `data` is refused because this pinned
build does not use it and the provider would serve those bytes instead of the file.

`tar-stream@3.2.2` is a direct development dependency, MIT, published 2026-10-02; npm's normal exact installation
honoured the repository's seven-day policy and reported zero audit findings. It provides non-extracting tar parsing
and checksum validation. Its pinned `extract.js` and `headers.js` silently consume some extensions and accept
permissive PAX records. A narrow framing/PAX validator therefore runs first; it is not a general archive reader.
Supported entries are regular files, directories, symlinks and hardlinks, with unique path/linkpath/time PAX records.
Only the exact first codeload global `comment=<locked revision>` record is permitted for the source archive;
image global/GNU headers are refused. Limits: 512 MiB per input/uncompressed archive and expanded image, 200,000
entries per archive, 128 image layers, 4 MiB per PAX record block; artifact directory limits are 128 MiB, 10,000
files and 32 directory levels. Larger/unsupported inputs fail for review.

## Source lock and Dockerfile interface

`source.lock.json` uses this closed schema; no self-referential Unset commit is stored in it:

```json
{
  "schema": 1,
  "base": {
    "ref": "ghcr.io/bluesky-social/pds:0.4.5037@sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4",
    "platform": "linux/amd64"
  },
  "builder": {
    "ref": "docker.io/library/node:26-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33",
    "node": "26.10.0",
    "pnpm": "11.11.0"
  },
  "source": {
    "revision": "a7c8604d876a200a1e4fa4aec83d4189ac4f1c12",
    "archiveSha256": "706ab7fa7410a406ed3d4e67837662e21ade7d4be4f6a33a491703c0805b0555",
    "lockSha256": "d56b93f5fe51bbad31919df7039be088e9e61f80f57017a188f02e35f2ca16f8"
  },
  "uiDirectory": "app/node_modules/.pnpm/@atproto+oauth-provider-ui@0.10.5/node_modules/@atproto/oauth-provider-ui/dist"
}
```

The source archive must have the exact `atproto-<revision>` root and locked `pnpm-lock.yaml`; its real package JSON
and the immutable image's package JSON must agree on `@atproto/pds@0.5.37`, `@atproto/oauth-provider@0.23.1` and
`@atproto/oauth-provider-ui@0.10.5`. A version update requires updating this dedicated checker with the paired lock.

The Dockerfile has exactly three stages: `FROM <builder.ref> AS ui-build`, `FROM scratch AS ui-artifact`, and
`FROM <base.ref>`. Its one ADD is exactly:

```dockerfile
ADD --checksum=sha256:<source.archiveSha256> https://codeload.github.com/bluesky-social/atproto/tar.gz/<source.revision> /tmp/atproto.tar.gz
```

The scratch `ui-artifact` stage exports only the finalized frontend under `/dist`. The final stage has exactly two
instructions after FROM: `RUN rm -rf /<uiDirectory>` and
`COPY --from=ui-artifact /dist/ /<uiDirectory>/`. No runtime install or provider rebuild is allowed. Source building
uses the reviewed frozen upstream toolchain, ignores dependency install scripts, preserves source files, and builds
only the frontend/supporting libraries. This is a reviewed build recipe; static instruction checks do not prove
arbitrary Dockerfile programs honest. Full artifact/layer verification remains mandatory.

The CI driver builds the artifact target and final candidate, saves actual immutable images, checks the separately
downloaded immutable source, and runs the same verifier. The Linux runner must match the declared native platform;
it does not silently emulate arm64 on amd64. Current local evidence is linux/arm64; amd64 is a P2.24c CI gate.
Build-only product scripts require no deployment import exception: this interface is Dockerfile-only.

## CLI and generated proof

With a clean checkout, Node 26.10.0 and `npm ci`:

```sh
node scripts/ci/pds-ui/cli.ts -- LOCK SOURCE_ARCHIVE BASE_OCI_ARCHIVE CANDIDATE_OCI_ARCHIVE CANDIDATE_DIGEST ARTIFACT_DIR UNSET_REVISION LOCK_SHA256
```

All arguments are positional after the literal `--`. The caller supplies the independently recorded expected
checkout revision and source-lock hash. The CLI rechecks both, compares source/image/UI inputs, rechecks checkout
cleanliness, and emits one JSON receipt. The actual Unset revision, source-lock hash, base/platform/source/builder
identity, candidate digest, complete artifact inventory hash and native manifest hash are bound in that receipt.
This detached build evidence avoids embedding labels in the candidate and thereby changing runtime Config.
It is input for later signed CI provenance, not publication/admission evidence on its own.

`node scripts/ci/pds-ui/build-check.ts` is the workflow driver. With a recipe present it requires `RUNNER_TEMP` and
writes `pds-ui-proof.json` there only after successful native builds and verification. BuildKit exports the artifact
target to a throwaway directory. Temporary image archives/source/artifacts are removed; the proof remains in CI's
temporary output and its log. This branch leaves the existing registry/signing process unchanged.

## Upstream manifest trap

The pinned unmodified output is byte-identical to the official dist but six native manifest hashes are stale:
three entry/chunk JavaScript files and their maps. The plugin computes intermediate `generateBundle` hashes.
Strict verification intentionally rejects that stock artifact. Before packaging, P2.24c must recompute **only**
each item's `sha256` from the final named file bytes using SHA256/base64, preserving every other manifest field and
all JavaScript/CSS/map bytes. Serialize the same native JSON map deterministically with two-space indentation.
This is distribution metadata generation, not a provider patch or a replacement manifest. A changed file after
that finalization still fails. The retained research candidate is an equality positive and a strict-manifest negative;
a separately labelled scratch candidate with only those six hashes corrected is the complete verification positive.

Sources read: [Dockerfile ADD --checksum](https://docs.docker.com/reference/dockerfile/#add---checksum),
[Docker save --platform](https://docs.docker.com/reference/cli/docker/image/save/#save-a-specific-platform---platform);
tar-stream 3.2.2 README/extract.js/headers.js and its own declarations in node_modules;
[OCI image spec v1.1.1 layer](https://github.com/opencontainers/image-spec/blob/v1.1.1/layer.md),
[configuration](https://github.com/opencontainers/image-spec/blob/v1.1.1/config.md) and
[descriptor](https://github.com/opencontainers/image-spec/blob/v1.1.1/descriptor.md);
atproto a7c8604d876a200a1e4fa4aec83d4189ac4f1c12
`packages/internal/rolldown-plugin-bundle-manifest/src/index.ts` and
`packages/oauth/oauth-provider/src/router/assets/assets-manifest.ts` from the retained source archive.
