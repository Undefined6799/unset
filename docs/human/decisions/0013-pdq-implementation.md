# 0013 — PDQ hasher: a TypeScript port of the reference, bit-exact

Status: Proposed (awaiting Alex in the P2.16b pull request)

## Context
Every photo and video frame the app processes is fingerprinted with PDQ, and only the hashes are compared with hash
lists (plan §5.8). The system must have exactly one hasher, used by `web` for images (P2.16) and by the review
container for video frames (P4.06), and that hasher must give the hashes a list provider expects: a wrong bit can let a
listed picture through. Step P2.16b fixes the pass criteria from ThreatExchange's own rule (`pdq/README.md:33-35` at
commit `85978d7cabdf631c0e4be9cb2be2816b2b9a6911`): bit-exact on the same bytes, within 10 bits end to end with our
decoder, and at most 150 ms per image.

## Decision
Port the reference C++ (`pdq/cpp/hashing`, `pdq/cpp/downscaling`, the resize rule of `pdq/cpp/io/pdqio.cpp`) to
TypeScript in `domains/moderation/fingerprint/pdq/` as pure functions, with every C++ `float` operation rounded by
`Math.fround` in the reference's order. Measured on the development container (Node 26.10, x86-64):

- Bit-exact with the compiled reference on all eleven vector images: nine synthetic images covering every size path
  and a flat image whose coefficients nearly tie, and two pinned ThreatExchange PNGs. All eight dihedral variants match
  too. The same reference build reproduces ThreatExchange's published regression hashes for `bridge-1-original.jpg`.
- About 12 ms for a 512×512 input, 36 ms including the squash from 640×480; the bound is 150 ms.

Two readings of the step, both following the reference:
- `pdqPreprocess` squashes to exactly 512×512 only when a side is larger than 512, and keeps a smaller image at its
  size, because the reference does (`pdqio.cpp:102-104`). Upscaling small images would change their hashes.
- The rotation test uses ThreatExchange's matching distance (31), not 10: the reference's own regression pair
  `bridge-2-rotate-90` is 14 bits from `bridge-1-original`'s rot90 variant, and its README says dihedral hashes are not
  exactly invariant.

## Alternatives
- Option B from the step, the reference C++ compiled to WASM on raw buffers: not needed, since the port meets every
  criterion; it would add a toolchain and an opaque binary to review.
- `pdq-wasm` 0.3.9 (npm, BSD-3-Clause, one maintainer) and `pdqhash-node` 1.1.0 (a native Rust binding), found by an
  npm registry search on 2026-10-05: rejected; a compiled third-party artefact on the child-abuse-material path is a
  supply-chain risk the port avoids, and neither shows bit-exactness against the reference.
- ThreatExchange's `pdq/wasm` demo: rejected by the step (emscripten 3.1.7 demo, and it compiles CImg, which is
  CeCILL-licensed).

## Consequences
The hasher has no dependency and runs anywhere Node runs. It must stay bit-exact: any change to the arithmetic is
checked by the reference vectors, which only the compiled reference can regenerate (README, "Regenerating the
vectors"). The BSD notice travels with the port in its README. The end-to-end criterion with sharp (JPEG quality 80,
distance ≤ 10) is tested when P2.17 adds sharp. A newer ThreatExchange commit is adopted only by re-running the
vectors against it and updating the pinned commit and SHA-256 values in `scripts/fetch-pdq-vectors.ts`.

## Compliance
`pdq.test.ts` and `dihedral.test.ts` (bit-exact synthetic vectors, timing, flat quality),
`tests/integration/pdq/fetched.test.ts` (bit-exact fetched images, rotations) and `scripts/fetch-pdq-vectors.test.ts`
(pinned commit and SHA-256) run in `npm test` on every pull request. Reviewed if a hash-list provider reports
mismatches, and when P4.06 hashes video frames.
