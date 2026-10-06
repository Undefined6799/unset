import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { currentFontMetrics, OUTPUT } from "./font-metrics.ts";

test("font_metrics_regenerates_committed_file", async () => {
  const committed = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "shared", "ui", OUTPUT), "utf8"));
  expect(await currentFontMetrics()).toEqual(committed);
});
