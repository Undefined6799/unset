// The config of the media proxy (P1.04): the common keys plus the server kit's.
import { defineEntrypointConfig } from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";

export const config = defineEntrypointConfig({ ...httpKitConfig });
