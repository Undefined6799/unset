import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PAGES, PROD_ORIGIN } from "./pages.ts";

const root = join(import.meta.dirname, "../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

describe("lhci_no_public_upload", () => {
  test("upload target is filesystem and the public bucket is absent", () => {
    const config = JSON.parse(read("lighthouserc.json")) as {
      ci: {
        collect: { numberOfRuns: number; url: string[] };
        assert: { assertions: { "categories:accessibility": [string, { minScore: number }] } };
        upload: { target: string };
      };
    };
    expect(config.ci.upload.target).toBe("filesystem");
    expect(read("lighthouserc.json")).not.toContain("temporary-public-storage");
    expect(read(".github/workflows/e2e.yml")).not.toContain("temporary-public-storage");
    expect(config.ci.collect.numberOfRuns).toBe(3);
    expect(config.ci.assert.assertions["categories:accessibility"]).toEqual(["error", { minScore: 1 }]);
    expect(config.ci.collect.url).toEqual(PAGES.map((page) => `${PROD_ORIGIN}${page.path}`));
  });

  test("pa11y visits the same pages and the job pins the audit-dirty CLIs outside the lockfile", () => {
    const pa11y = JSON.parse(read(".pa11yci.json")) as {
      defaults: { levelCapWhenNeedsReview: string; ignore: string[] };
      urls: string[];
    };
    expect(pa11y.urls).toEqual(PAGES.map((page) => `${PROD_ORIGIN}${page.path}`));
    // axe-core 4.13.0 reports the button's ::before fill and a full-bleed h1 as incomplete
    // ("needs review"), which pa11y 9 promotes to an error. HTML_CodeSniffer does not see the
    // mark's aria-label or that fill. Real violations stay errors: contrast below 4.5:1, link-name.
    expect(pa11y.defaults.levelCapWhenNeedsReview).toBe("warning");
    expect(pa11y.defaults.ignore).toEqual([
      "WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent",
      "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail",
    ]);
    const workflow = read(".github/workflows/e2e.yml");
    expect(workflow).toContain("pa11y-ci@5.0.0");
    expect(workflow).toContain("@lhci/cli@0.15.1");
    expect(workflow).toContain("retention-days: 14");
    expect(workflow).toContain("npm ci --ignore-scripts");
    // Stylesheets are served uncompressed. The 12KB gzip cap stays in scripts/budgets/css.ts.
    const lighthouse = JSON.parse(read("lighthouserc.json")) as {
      ci: { assert: { assertions: { "resource-summary:stylesheet:size": [string, { maxNumericValue: number }] } } };
    };
    expect(lighthouse.ci.assert.assertions["resource-summary:stylesheet:size"][1].maxNumericValue).toBe(53248);
  });
});
