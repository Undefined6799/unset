// web's review lanes match review's children (limits.ts REVIEW_LANES, interfaces/review/config.ts REVIEW_CHILDREN):
// with more lanes than children, a picture would wait in review's queue on its 20 s job clock while web's 30 s timeout
// runs, and the last of four could time out (review of #1840). Read from the source, since the two are separate
// processes and neither imports the other.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { REVIEW_LANES } from "../../../interfaces/web/src/lib/server/limits.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");

test("review_lanes_match_review_children", () => {
  const config = readFileSync(join(REPOSITORY, "interfaces", "review", "config.ts"), "utf8");
  const children = Number(/REVIEW_CHILDREN: int\(\{[^}]*default: (\d+)/.exec(config)?.[1]);
  expect(children).toBeGreaterThan(0);
  expect(REVIEW_LANES).toBe(children);
});
