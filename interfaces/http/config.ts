// The config of the web server (unset.sh) (P1.04): the common keys plus the server kit's.
import { defineEntrypointConfig, str } from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";

export const config = defineEntrypointConfig({
  ...httpKitConfig,
  /** apps/web's browser build, the directory holding `.vite/manifest.json` (P1.23). Empty means apps/web/dist/client. */
  WEB_BUILD_DIR: str({ default: "" }),
});
