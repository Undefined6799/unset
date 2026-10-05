// Expected PDQ output from the C++ reference (ThreatExchange commit 85978d7cabdf631c0e4be9cb2be2816b2b9a6911,
// g++ 13.3 -std=c++11 -O3 on x86-64, the reference Makefile's flags; how to regenerate them is in
// domains/moderation/fingerprint/pdq/README.md). Dihedral order: orig, rot90, rot180, rot270, flipx, flipy, flipplus1,
// flipminus1.

/** The fetched ThreatExchange PNGs (scripts/fetch-pdq-vectors.ts) as the reference hashes them when CImg decodes them
 * with libpng, keeping the first three channels; fixtures/png.ts yields the same bytes. */
export const FETCHED_EXPECTED = {
  "pen-and-coaster.png": {
    hash: "1f811b9d267fbc6613c0c7f30e041f9df49b836303e10f067fcffc12c02d01f9",
    quality: 100,
    dihedral: [
      "1f811b9d267fbc6613c0c7f30e041f9df49b836303e10f067fcffc12c02d01f9",
      "14c6fb71308c2673d31c4c67ef783286cda9cf963463ba7a618b8ce534dc1a1c",
      "4ad4b137732a16cc469569595b51b537a1cea9c956b4a5ac2a9a56b89578ab53",
      "41d351db65d9ccd98649e6cdba2d982cd8fc6d3c613630d034de264f6189b0be",
      "1f81f4e2267f439913c03c4c0e04e062f49bfc9c03e1f0f97fcf07edc02dfe06",
      "4ad44ec8733ae93346d596e65b514ac8a1ced63656b45a532a9bad47957854ac",
      "14c6048e308cd98cd31cb79cef78cd79cda93c6934636585618b731a34dce5eb",
      "41d3ae2465d9732686491936ba2d67d398fc96c36136cf2f34ded9b061894f41",
    ],
  },
  "c.png": {
    hash: "e4cc89d91c623842f8d1f1d9a398e78c9f199a3bf87925f2b7e11e0bf061b064",
    quality: 100,
    dihedral: [
      "e4cc89d91c623842f8d1f1d9a398e78c9f199a3bf87925f2b7e11e0bf061b064",
      "8182fafd1c1bc31078245e6b03c4b87f4f1853e4207bf90fc7e47efe2054f711",
      "f119a322493792aaed94db7256cd6d26ca4cb8914d6d8e58e5b4b4a9a5349ace",
      "d4d75057494e69ba2d71f4c1569112d51a4df94e752e53a592b1d45475015dbb",
      "844cf6771c62c7ff38c18e27039838739719edc41839db0d30e1e1f4f061cf9b",
      "d1195cdd49376d556d94248d56cd92d9c24c476e4d6c71a765b44b5ea5346531",
      "cfeb8d229f3b3cef78e4a19c03cc4798cf18fc3b207b4ef0c7e4810130544cee",
      "dcdfafa8c94e96452df10b3e5691ed2a1a4d06b1752eac5a92b52bab7501a264",
    ],
  },
} as const;
