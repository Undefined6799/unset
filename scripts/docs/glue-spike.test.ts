// P1.20: the framework-glue ADR's numbers are recomputed from the raw reports it ships, never read back from
// MEASUREMENTS.json alone, and the verdict follows step 5's rule.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  ADR,
  cssMapMismatches,
  deriveMeasurements,
  EVIDENCE,
  glueVerdict,
  type Measurements,
  readRawReports,
} from "./glue-spike.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(ROOT, file), "utf8"));

/** A measurement that passes every condition of step 5; each test breaks one. */
function passing(): Measurements {
  const hono = readJson(join(EVIDENCE, "hono", "MEASUREMENTS.json")) as Measurements;
  return structuredClone({
    ...hono,
    glueLines: { ...hono.glueLines, total: 600 },
    cssIdentical: { dev: true, prod: true, mismatches: [] },
    hydrationErrors: 0,
    cspViolations: 0,
    styleAttrViolations: 1,
    styleAttrViolationsElsewhere: 0,
    zeroJsRoute: { scriptTags: 0, modulePreloads: 0, jsBytes: 0 },
    jsGzipBytes: { ...hono.jsGzipBytes, headroomFor75KB: 15 * 1024, perIsland: { Counter: 15 * 1024 } },
  });
}

describe("framework-glue spike", () => {
  test("css_map_diff_detects_mismatch", () => {
    const server = { "a.module.css": { box: "box_1", row: "row_2" } };
    expect(cssMapMismatches(server, structuredClone(server))).toEqual([]);
    expect(cssMapMismatches(server, { "a.module.css": { box: "box_1", row: "row_3" } })).toEqual([
      "a.module.css .row: row_2 ≠ row_3",
    ]);
    expect(cssMapMismatches(server, {})).toEqual(["a.module.css: missing on one side"]);
  });

  test("hono_verdict_consistent", () => {
    const recorded = readJson(join(EVIDENCE, "hono", "MEASUREMENTS.json")) as Measurements;
    const raw = readRawReports(join(ROOT, EVIDENCE, "hono"), recorded.rawReports);
    const derived = deriveMeasurements(raw);
    expect(derived).toEqual(recorded);
    expect(glueVerdict(derived)).toBe(recorded.verdict);
    const nulls = JSON.stringify(recorded, (key, value) => (key === "hydrationErrorsByEngine" ? undefined : value));
    expect(nulls).not.toContain("null");
    const shipped = readdirSync(join(ROOT, EVIDENCE, "hono", "raw")).map((f) => `raw/${f}`);
    expect(recorded.rawReports.toSorted()).toEqual(shipped.toSorted());
  });

  test("verdict_rule", () => {
    expect(glueVerdict(passing())).toBe("PASS");
    const borderline = passing();
    borderline.glueLines.total = 700;
    expect(glueVerdict(borderline)).toBe("BORDERLINE");
    const breaks: ((m: Measurements) => void)[] = [
      (m) => {
        m.glueLines.total = 701;
      },
      (m) => {
        m.cssIdentical.prod = false;
      },
      (m) => {
        m.cssIdentical.dev = false;
      },
      (m) => {
        m.hydrationErrors = 1;
      },
      (m) => {
        m.cspViolations = 1;
      },
      (m) => {
        m.styleAttrViolations = 0;
      },
      (m) => {
        m.styleAttrViolationsElsewhere = 1;
      },
      (m) => {
        m.zeroJsRoute.jsBytes = 1;
      },
      (m) => {
        m.jsGzipBytes.headroomFor75KB = 15 * 1024 - 1;
      },
      (m) => {
        m.jsGzipBytes.perIsland.Counter = 15 * 1024 + 1;
      },
    ];
    for (const breakOne of breaks) {
      const m = passing();
      breakOne(m);
      expect(glueVerdict(m)).toBe("FAIL");
    }
  });

  test("astro_measurements_recorded", () => {
    const astro = readJson(join(EVIDENCE, "astro", "MEASUREMENTS.json")) as Record<string, unknown>;
    expect(astro.candidate).toBe("astro");
    if (astro.verdict === "INCOMPLETE") {
      expect(typeof astro.measured).toBe("object");
      return;
    }
    const hono = readJson(join(EVIDENCE, "hono", "MEASUREMENTS.json")) as Record<string, unknown>;
    expect(Object.keys(astro).toSorted()).toEqual(expect.arrayContaining(Object.keys(hono).toSorted()));
  });

  test("adr_has_required_sections", () => {
    expect(existsSync(join(ROOT, ADR))).toBe(true);
    const headings = readFileSync(join(ROOT, ADR), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());
    for (const heading of ["Context", "Fixture", "Versions", "Measurements", "Verdict", "Consequences"]) {
      expect(headings).toContain(heading);
    }
    expect(headings).toContain("Carried into P1.23");
  });
});
