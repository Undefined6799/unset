# PDQ hasher

The one picture fingerprint in unset.sh (step P2.16b, ADR [0013](../../../../docs/human/decisions/0013-pdq-implementation.md)).
`web` hashes images with it before publishing (P2.16) and the review container hashes video frames with it (P4.06).
Only hashes leave our servers, never pictures (plan §5.8).

It is a TypeScript port of Meta's reference C++ implementation in
[ThreatExchange `pdq/`](https://github.com/facebook/ThreatExchange/tree/85978d7cabdf631c0e4be9cb2be2816b2b9a6911/pdq)
at commit `85978d7cabdf631c0e4be9cb2be2816b2b9a6911`. Given the same RGB bytes it gives the same bits as the
reference, bit for bit, including the eight rotations and flips.

## Use

```ts
import { pdqDihedral, pdqHash, pdqPreprocess } from "@unset/domains-moderation";

const luma = pdqPreprocess({ width, height, data }); // RGB bytes, already oriented, alpha removed
const hash = pdqHash(luma); // { bits: 32 bytes, quality: 0..100 }
const all8 = pdqDihedral(luma); // orig, rot90, rot180, rot270, flipx, flipy, flipplus1, flipminus1
```

Decoding is the caller's job (P2.17 decodes with sharp in a child process). A hash with quality below 50 is not
sent anywhere (P2.16; ThreatExchange recommends discarding at 49 and below).

## How it works

1. `pdqPreprocess`: an image larger than 512 on either side is squashed to exactly 512×512 by nearest neighbour, as
   the reference does with CImg's default resize; a smaller one keeps its size. Then luminance
   `0.299 R + 0.587 G + 0.114 B` in 32-bit float.
2. `pdqHash`: a two-pass Jarosz box filter (a tent filter) and decimation to 64×64, a quality score from the
   gradients, a 16×16 DCT, and one bit per coefficient: set when it is above the median.
3. `pdqDihedral`: the eight variants come from one DCT by moving and negating coefficients, as the reference does.

The reference computes in C++ `float`. Every float operation here is rounded with `Math.fround`, in the reference's
order. That is exact: a double holds the exact sum, difference, product or quotient of two floats, so rounding it
once gives the float result. Leaving out a single rounding breaks the flat-image vector, where coefficients are
nearly tied.

A 512×512 input takes about 12 ms (36 ms when squashing 640×480) on the development container; the test bound is
150 ms at p95.

## Tests and reference vectors

- `pdq.test.ts`, `dihedral.test.ts`: nine synthetic images (`fixtures/synthetic.ts`) covering every path (squashed on
  both sides, on one side, kept, 64×64, 5×5, below 5×5, flat) against the reference's output in
  `fixtures/reference-vectors.ts`. No network.
- `tests/integration/pdq/`: two ThreatExchange PNGs, fetched at the pinned commit by `scripts/fetch-pdq-vectors.ts`,
  which checks each file's SHA-256. The images are never committed (ThreatExchange provides them for open-source
  testing only, `pdq/wasm/README.md:7`). Also checks that a turned picture lands nearest to its own variant.
- The end-to-end check with sharp (JPEG quality 80, distance ≤ 10) lands with P2.17, which adds sharp.

### Regenerating the vectors

The expected values come from the reference itself, compiled with the flags of its own Makefile (`g++ -std=c++11
-O3`, x86-64, g++ 13.3). This build reproduces the reference's published regression output
(`pdq/cpp/reg_test/expected/out`) for `bridge-1-original.jpg`, all eight variants.

1. Check out ThreatExchange at the pinned commit.
2. Write a small `main` that reads `uint32 width, uint32 height` (little endian) and the RGB bytes, puts them into a
   `CImg<uint8_t>(width, height, 1, 3)`, applies `pdqio.cpp`'s `resize(512, 512)` rule, fills luminance with
   `fillFloatLumaFromRGB` and calls `pdqHash256FromFloatLuma` and `pdqDihedralHash256esFromFloatLuma`, printing
   `Hash256::format()` and the quality.
3. Compile it with `pdq/cpp/{hashing,downscaling,common}/*.cpp` and `-I<checkout> -Ipdq/cpp`, feed it the bytes of
   `syntheticImage(spec)` for each case, and for the PNGs load them with `-Dcimg_use_png` and keep channels 0 to 2.

CImg is used only on the developer's machine to make the vectors; it is never part of this repository or a build.

## Licence

The algorithm and its constants are ported from ThreatExchange, which is under the BSD licence below. This port is
part of unset.sh (AGPL-3.0-only) and keeps the notice.

```text
BSD License

For ThreatExchange software

Copyright (c) Meta Platforms, Inc. and affiliates.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

 * Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

 * Neither the name Facebook nor the names of its contributors may be used to
   endorse or promote products derived from this software without specific
   prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
