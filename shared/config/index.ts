// Typed configuration for every entrypoint (P1.02). Read once at boot with `bootOrExit`; secrets print as
// `[secret]` and leave only through `Secret.reveal()`.
export type { LoadOptions, Problem, Reason } from "./load.ts";
export { bootOrExit, ConfigError, describeConfig, loadConfig } from "./load.ts";
export type { Config, Field, Fields, Kind, Rule, Schema } from "./schema.ts";
export {
  bool,
  defineConfig,
  defineEntrypointConfig,
  int,
  list,
  oneOf,
  origin,
  SERVICES,
  secret,
  secretFile,
  str,
  url,
} from "./schema.ts";
export { Secret } from "./secret.ts";
