import { devices, type PlaywrightWorkerOptions, type test } from "@playwright/test";

type PhoneViewport = { width: number; height: number };
type BrowserName = PlaywrightWorkerOptions["browserName"];

/**
 * Playwright 1.64.1: node_modules/playwright-core/lib/coreBundle.js deviceDescriptorsSource (Pixel 7/iPhone 15).
 * Select only context options: defaultBrowserType is worker-scoped and cannot change inside test.describe
 * (node_modules/playwright/lib/index.js defaultBrowserType and _combinedContextOptions fixtures).
 */
export function phoneContext(browserName: BrowserName, viewport: PhoneViewport) {
  const device = devices[browserName === "webkit" ? "iPhone 15" : "Pixel 7"];
  if (device === undefined) throw new Error("the pinned phone descriptor is missing");
  return {
    viewport,
    userAgent: device.userAgent,
    deviceScaleFactor: device.deviceScaleFactor,
    // Firefox supports this in 1.64.1: coreBundle.js FFBrowserContext.doUpdateDefaultViewport passes isMobile
    // to Browser.setDefaultViewport. All three engines therefore use mobile layout as well as touch.
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
  };
}

/** Test-scoped options override the desktop project's options before its context is created. */
export function phone(
  viewport: PhoneViewport,
): Pick<Parameters<typeof test.use>[0], "viewport" | "userAgent" | "deviceScaleFactor" | "isMobile" | "hasTouch"> {
  return {
    viewport,
    userAgent: async ({ browserName }, use) => use(phoneContext(browserName, viewport).userAgent),
    deviceScaleFactor: async ({ browserName }, use) => use(phoneContext(browserName, viewport).deviceScaleFactor),
    isMobile: async ({ browserName }, use) => use(phoneContext(browserName, viewport).isMobile),
    hasTouch: async ({ browserName }, use) => use(phoneContext(browserName, viewport).hasTouch),
  };
}
