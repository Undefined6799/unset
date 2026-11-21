// The tests' Synapse is the one we ship (review finding B5). Tests run upstream's image (tests/support/synapse.ts
// SYNAPSE_IMAGE), and the stack runs our own image, built from hash-pinned wheels (deployment/images/synapse.Dockerfile,
// synapse-requirements.in and its compiled lock synapse-requirements.txt, ADR 0086 Decision 1). The two are pinned in
// separate files, so a bump of one alone would leave the server rule and the e2e runs tested on a Synapse the stack
// does not run. This holds them to one version.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SYNAPSE_IMAGE } from "../../support/synapse.ts";

const IMAGES = join(import.meta.dirname, "../../../deployment/images");
const read = (name: string) => readFileSync(join(IMAGES, name), "utf8");

/** The one `matrix-synapse==X` pin in a requirements file, or every one found, so a second pin fails too. */
const pins = (text: string) => [...text.matchAll(/^matrix-synapse==(\S+)/gm)].map((m) => m[1]);

describe("the Synapse version", () => {
  test("synapse.tests_run_the_shipped_version: the test image's tag is the version our image installs", () => {
    const tag = /^docker\.io\/matrixdotorg\/synapse:v(\d+\.\d+\.\d+)@sha256:[0-9a-f]{64}$/.exec(SYNAPSE_IMAGE)?.[1];
    expect(tag).toBeDefined();
    expect(pins(read("synapse-requirements.txt"))).toEqual([tag]);
    expect(pins(read("synapse-requirements.in"))).toEqual([tag]);
  });
});
