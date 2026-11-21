---
status: Accepted
date: "2026-11-21"
accepted:
  at: "2026-11-21T22:03:46Z"
  head: 68f0026d68222647fb04d4ce26fce4cb748e799a
  line: "yes accept 1944"
step: P6.02
---
# 0092 — The chat Synapse image runs on distroless Python

Alex chose this on 2026-11-21 at 20:08Z, on the decision card "Yes, use distroless", and accepted the record at
22:03:46Z in the project chat ("yes accept 1944"), of pull request 1944's reviewed head 68f0026d (ADR 0083).

## Context

The chat stack builds its own Synapse image (P6.02). The first base was `python:3.13-slim-trixie` for every stage.
Trivy v0.76.1 (the CI image, `aquasec/trivy@sha256:790fd66d…`) reports, for that base at
`sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90` on 2026-11-21, zlib1g CVE-2026-85091 and five
HIGH findings in pip's vendored packages: msgpack CVE-2026-114613 and GHSA-6v7p-g79w-8964, setuptools CVE-2025-47273,
urllib3 CVE-2026-97687 and CVE-2026-97689. They come from `pip/_vendor/bom.cdx.json`, and Trivy can scope a waiver for
them only by package URL, not by path (`pkg/result/filter.go:100`, `pkg/result/ignore.go:152-162` at v0.76.1). Alex
refused a waiver for them (19:42Z, "No, hold the Python mirror").

Facts read for this record (rule DO-3), 2026-11-21:
- `gcr.io/distroless/python3-debian13` contains "a minimal Linux, Python-based runtime" with Python 3.13 and "No
  shell", and for a multi-stage build targeting it upstream recommends "`python:3.13-slim-trixie` for your build
  stage" (GoogleContainerTools/distroless `python3/README.md`, main at 2adb3ee2).
- The `nonroot` tag's index is `sha256:6c4cb3bfa4b555429dd19541796a6ba6b30c84675b460bd0bd5072f7d5bdae71` (gcr.io
  manifest endpoint, `docker-content-digest`; the index body hashes to the same value).
- Distroless images are keyless-signed; the README gives `cosign verify $IMAGE_NAME --certificate-oidc-issuer
  https://accounts.google.com --certificate-identity keyless@distroless.iam.gserviceaccount.com`. cosign v3.1.3
  with `deployment/sigstore/trusted_root.json` verifies `6c4cb3bf` with that identity and exits 12 for another one.
- Trivy v0.76.1 with CI's runtime flags (`--severity HIGH,CRITICAL --ignore-unfixed`, the shared ignore file) finds 0
  in `6c4cb3bf`. On the build-only base CI fails only on CRITICAL (`mirror.yml`, build stage), and `e48f59cd` has none.

## Decision

1. **Runtime base:** the Synapse image's final stage builds on `gcr.io/distroless/python3-debian13:nonroot`, pinned by
   index digest. It is a vendor base (`VENDOR_BASES` in `deployment/images/vendor.ts`), by its exact name, as SeaweedFS
   is under ADR 0041. It ships no shell, pip or package manager, so the pip findings above are not in the image.
2. **Build-only base:** `python:3.13-slim-trixie` stays, for build stages only, as upstream pairs it. It is mirrored
   with stage `build`; the mirror scan fails it on CRITICAL and reports HIGH. No Trivy ignore file is added for either
   base.
3. **Signature before copy:** `mirror.yml` copy-and-sign verifies the distroless keyless signature with the identity
   and issuer above, against the offline trusted root (ADR 0033 Decision 4), before it copies the digest.

## Consequences

- The Synapse Dockerfile (chat branch) must copy its virtual environment into an image with no shell: no `RUN` in the
  final stage, and paths that match distroless's `/usr/bin/python` (upstream's note on virtual environments).
- Distroless records its Debian packages in `/var/lib/dpkg/status.d/`, one file per package, not in
  `/var/lib/dpkg/status`. The image tests that read the package database learn that layout with the Synapse kind, on
  the chat branch.
- A distroless re-pin is a new digest of the same name, scanned by the PR's pins job and by the mirror.

## Alternatives

- **A waiver for the five pip findings** (`.github/trivyignore.python.yaml`): refused by Alex at 19:42Z. It could only
  name package URLs, not pip's files.
- **Deleting pip from a slim final stage** (not chosen): keeps a shell and apt in the shipped image, and every base
  re-pin would need the deleted paths re-checked.

## Compliance

`deployment/images/images.test.ts` holds the lock: `vendor_bases_are_named_runtime_bases` names distroless as the
second vendor base, by exact name, refuses look-alike names, and fixes its entry as a runtime base no run-only image
shares; `lock_records_the_index_digest` fixes `python` as a build-only entry. `scripts/ci/image-workflows.test.ts`
(`mirrored_digest_equals_lock`) holds the signature check with the exact identity and issuer, before the copy.
