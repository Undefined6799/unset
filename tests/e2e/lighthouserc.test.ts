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
        collect: { numberOfRuns: number; url: string[]; settings: { chromeFlags: string } };
        assert: {
          assertMatrix: {
            matchingUrlPattern: string;
            assertions: Record<string, [string, { minScore?: number; maxNumericValue?: number }]>;
          }[];
        };
        upload: { target: string };
      };
    };
    expect(config.ci.upload.target).toBe("filesystem");
    expect(read("lighthouserc.json")).not.toContain("temporary-public-storage");
    expect(read(".github/workflows/e2e.yml")).not.toContain("temporary-public-storage");
    expect(config.ci.collect.numberOfRuns).toBe(3);
    // @lhci/cli 0.15.1 collect.settings.chromeFlags (docs/configuration.md). ubuntu-24.04's
    // AppArmor blocks Chrome's unprivileged user namespace, so the launcher needs --no-sandbox.
    // P1.37j: our COOP header moves the page into a spare renderer that the trace can miss the
    // start of (Lighthouse NO_NAVSTART), so SpareRendererForSitePerProcess is off. Chrome keeps
    // only the last --disable-features, so the list repeats chrome-launcher 1.2.2's defaults
    // (dist/flags.js DEFAULT_FLAGS), RenderDocument among them, then adds the one feature.
    const launcherDefaults = [
      "Translate",
      "OptimizationHints",
      "MediaRouter",
      "DialMediaRouteProvider",
      "CalculateNativeWinOcclusion",
      "InterestFeedContentSuggestions",
      "CertificateTransparencyComponentUpdater",
      "AutofillServerCommunication",
      "PrivacySandboxSettings4",
      "RenderDocument",
    ];
    const features = [...launcherDefaults, "SpareRendererForSitePerProcess"].join(",");
    // P1.20k: the harness serves https://unset.test (pages.ts), which only Chromium's resolver rule reaches, over a
    // certificate made for the run (fixtures/servers.ts). Lighthouse 12.6.1 parses the flag string with yargs-parser
    // (cli/run.js:33-50 parseChromeFlags), which keeps a quoted value with spaces as one flag.
    const harness = '--host-resolver-rules="MAP unset.test 127.0.0.1" --ignore-certificate-errors';
    expect(config.ci.collect.settings.chromeFlags).toBe(
      `--no-sandbox --disable-dev-shm-usage ${harness} --disable-features=${features}`,
    );
    // lhci 0.15.1 passes settings to the Lighthouse CLI as its flags file (src/collect/node-runner.js:45-69), and
    // Lighthouse 12.6.1 maps chromeIgnoreDefaultFlags to the launcher's ignoreDefaultFlags (cli/run.js:87), which
    // would drop the defaults this list repeats.
    expect(config.ci.collect.settings).not.toHaveProperty("chromeIgnoreDefaultFlags");
    expect(config.ci.collect.url).toEqual(PAGES.map((page) => `${PROD_ORIGIN}${page.path}`));
    // @lhci/cli 0.15.1 refuses assertMatrix together with assertions (utils/src/assertions.js).
    // Every page a person reads runs SvelteKit's client (ADR 0054 for the app pages; ADR 0116 for the rest: the
    // public profile since book P1.22e, home, the legal pages and the invite request since P1.22g, the sign-in, join
    // and blocked pages since P1.22l), so the "0 scripts" row is gone and each has the app pages' line: the one
    // bundle of output.bundleStrategy "single" was 99214 bytes as served (brotli) at P1.20k. Its 120 KiB is a warning,
    // never a failure (Alex, 2026-11-18T04:18:09Z; scripts/budgets/app-js.ts measures it in gzip). A page that turns
    // the client off again would need its own row with "0 scripts" as an error, which the loop below asks for.
    const matrix = config.ci.assert.assertMatrix;
    for (const row of matrix) {
      expect(row.assertions["categories:accessibility"]).toEqual(["error", { minScore: 1 }]);
    }
    for (const page of PAGES) {
      const url = `${PROD_ORIGIN}${page.path}`;
      const rows = matrix.filter((row) => new RegExp(row.matchingUrlPattern).test(url));
      expect(rows, page.path).toHaveLength(1);
      const script = rows[0]?.assertions["resource-summary:script:size"];
      expect(script, page.path).toEqual(
        page.expectJs ? ["warn", { maxNumericValue: 122880 }] : ["error", { maxNumericValue: 0 }],
      );
    }
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
      ci: {
        assert: {
          assertMatrix: { assertions: { "resource-summary:stylesheet:size": [string, { maxNumericValue: number }] } }[];
        };
      };
    };
    for (const row of lighthouse.ci.assert.assertMatrix) {
      expect(row.assertions["resource-summary:stylesheet:size"][1].maxNumericValue).toBe(53248);
    }
  });
});
