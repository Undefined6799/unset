// Points pa11y and Lighthouse at the Chromium Playwright installed (P1.26).
// @lhci/cli 0.15.1 reads CHROME_PATH (docs/configuration.md, chromePath). Puppeteer, which
// pa11y-ci 5.0.0 launches, reads PUPPETEER_EXECUTABLE_PATH.
import { appendFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const file = process.env.GITHUB_ENV;
if (file === undefined || file === "") throw new Error("GITHUB_ENV is unset");
const path = chromium.executablePath();
appendFileSync(file, `CHROME_PATH=${path}\nPUPPETEER_EXECUTABLE_PATH=${path}\n`);
