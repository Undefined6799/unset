// The config of the indexer (a health-only server until its Tap consumer lands) (P1.04): the common keys plus the server kit's.
import { defineEntrypointConfig } from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";

export const config = defineEntrypointConfig({ ...httpKitConfig });
