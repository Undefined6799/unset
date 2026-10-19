// C29 (P1.36k; architecture 2026-10-19 03:50Z): under --env dev and prod, no service gets a local-only runtime key and
// every origin it gets is https. The runtime allows plain http origins whenever UNSET_ENV is dev (shared/http/config.ts
// secureOrDev), and staging runs dev too, so only the deploy profile can tell local from staging. A failure names the
// key and the service in the outcome's own fields (P1.37k), never the value.
import { type LOCAL_ONLY_KEY_NAMES, LOCAL_ONLY_KEYS } from "../local-only.ts";
import type { SecretMap } from "../secret-map.ts";
import { type Check, fail, type NamedKey, ORIGIN_KEYS, pass } from "./types.ts";

const isLocalOnly = (name: string): name is (typeof LOCAL_ONLY_KEY_NAMES)[number] => LOCAL_ONLY_KEYS.has(name);

const isHttps = (raw: string): boolean => URL.canParse(raw) && new URL(raw).protocol === "https:";

/** The first origin key in `env` that is not https, or undefined. */
function plainOrigin(env: SecretMap): NamedKey | undefined {
  return ORIGIN_KEYS.find((name) =>
    env.use(name, (raw) => raw !== undefined && !(name === "ASSETS_BASE" && raw === "") && !isHttps(raw)),
  );
}

export const c29: Check = {
  id: "C29",
  run: ({ env: stage, serviceEnv }) => {
    if (stage === "local") return pass("skipped: local stack");
    for (const [service, env] of serviceEnv) {
      const key = env.names().find(isLocalOnly);
      if (key !== undefined) return { ...fail("it is for a local stack only"), key, service };
      const origin = plainOrigin(env);
      if (origin !== undefined) return { ...fail("the origin lacks TLS"), key: origin, service };
    }
    return pass();
  },
};
