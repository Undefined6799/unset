// The config of the web server (unset.sh) (P1.04): the common keys plus the server kit's.
import { defineEntrypointConfig, int, str, withRule } from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";

/**
 * The browser session timeouts (P2.03x; plan section 5.3 "Lifecycle": idle 7 days, absolute 30 days), in seconds,
 * read by the session store (P2.03) against the database clock. The absolute limit is also the cookie's Max-Age, so
 * it may be shorter than 30 days but never longer. Idle never outlasts absolute, and a session is touched more often
 * than it can go idle.
 */
export const sessionConfig = {
  SESSION_IDLE_S: withRule(
    int({ min: 300, max: 2_592_000, default: 604_800 }),
    (config) => Number(config.SESSION_IDLE_S) <= Number(config.SESSION_ABSOLUTE_S),
  ),
  SESSION_ABSOLUTE_S: int({ min: 300, max: 2_592_000, default: 2_592_000 }),
  SESSION_TOUCH_INTERVAL_S: withRule(
    int({ min: 1, max: 3600, default: 300 }),
    (config) => Number(config.SESSION_TOUCH_INTERVAL_S) < Number(config.SESSION_IDLE_S),
  ),
};

export const config = defineEntrypointConfig({
  ...httpKitConfig,
  ...sessionConfig,
  /** apps/web's browser build, the directory holding `.vite/manifest.json` (P1.23). Empty means apps/web/dist/client. */
  WEB_BUILD_DIR: str({ default: "" }),
});
