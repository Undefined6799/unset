// The unset.cc door's settings (build step 6; ADR 0081 decision 4; ADR 0025: unset.cc, staging.unset.cc for staging),
// read once at boot through shared/config, exit 78 when invalid. The kit's keys without MEDIA_ORIGIN, which only pages
// that show pictures need, and web's origin, where the hop signs its ticket.
import { defineEntrypointConfig, origin, withRule } from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";

const { MEDIA_ORIGIN: _media, ...kit } = httpKitConfig;

export const schema = defineEntrypointConfig({
  ...kit,
  /** unset.sh's origin: GET /chat/sign-in signs the ticket there (interfaces/web). Another origin than the door's. */
  WEB_ORIGIN: withRule(origin({ protocols: ["https:"] }), (config) => config.WEB_ORIGIN !== config.PUBLIC_ORIGIN),
});
