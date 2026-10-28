import * as web from "@unset/apps-web";
import { createLogger, type Logger } from "@unset/shared-log";
import { type PageSpec, pageResponse } from "../page.ts";

/** A logger for tests that do not read the log. */
export const silentLog = (): Logger =>
  createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });

/** Route tests' page renderer: apps/web's source render with a stub build, assets on the test origin. */
export function testPage(log: Logger = silentLog()): (page: PageSpec) => Response {
  return (page) =>
    pageResponse(
      {
        build: {
          manifest: {
            boot: "assets/boot.js",
            styles: [],
            fonts: [],
            icons: { favicon: "assets/icon.png", appleTouch: "assets/touch.png" },
            islands: new Map(),
          },
          files: new Map(),
        },
        render: web.renderPage,
        assetsOrigin: "https://unset.test",
        env: "test",
        log,
      },
      page,
    );
}
