// The web process's settings (ADR 0054 decision 3): shared-config like every other process, so the cross-field rules
// and exit 78 hold here too. server.ts loads them with bootOrExit before it imports SvelteKit's handler and shares them
// through the process note (note.ts). A slice adds the fields its routes need, as interfaces/http/config.ts has them.
import { poolFields, postgresFields } from "@unset/infrastructure-postgres";
import { bool, type Config, defineEntrypointConfig, int, withRule } from "@unset/shared-config";
import { httpKitConfig } from "@unset/shared-http";

/** Browser session timeouts (plan section 5.3), as interfaces/http/config.ts defines them. */
const sessionConfig = {
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

/** The test-only routes under /test-routes/ (P1.25c): only `test` may turn them on; every other profile refuses. */
const testRoutesConfig = {
  TEST_ROUTES: withRule(
    bool({ default: false }),
    (config) => config.TEST_ROUTES !== true || config.UNSET_ENV === "test",
  ),
};

export const schema = defineEntrypointConfig({
  ...httpKitConfig,
  ...sessionConfig,
  ...postgresFields,
  ...poolFields,
  ...testRoutesConfig,
});

export type WebConfig = Config<(typeof schema)["fields"]>;
