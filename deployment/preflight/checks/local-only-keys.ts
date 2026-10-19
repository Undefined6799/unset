// C29 (P1.36k; architecture 2026-10-19 03:50Z): under --env dev and prod, no service gets a local-only runtime key and
// every origin it gets is https. The runtime allows plain http origins whenever UNSET_ENV is dev (shared/http/config.ts
// secureOrDev), and staging runs dev too, so only the deploy profile can tell local from staging. A reason names the
// key and the service, never the value.
import { LOCAL_ONLY_KEYS } from "../local-only.ts";
import type { SecretMap } from "../secret-map.ts";
import { type Check, fail, pass } from "./types.ts";

/** The http kit's origin-valued keys (shared/http/config.ts); an empty ASSETS_BASE means the public origin's. */
const ORIGIN_KEYS = ["PUBLIC_ORIGIN", "MEDIA_ORIGIN", "ASSETS_BASE"] as const;

const isHttps = (raw: string): boolean => URL.canParse(raw) && new URL(raw).protocol === "https:";

/** The first origin key in `env` that is not https, or undefined. */
function plainOrigin(env: SecretMap): string | undefined {
  return ORIGIN_KEYS.find((name) =>
    env.use(name, (raw) => raw !== undefined && !(name === "ASSETS_BASE" && raw === "") && !isHttps(raw)),
  );
}

export const c29: Check = {
  id: "C29",
  run: ({ env: stage, serviceEnv }) => {
    if (stage === "local") return pass("skipped: local stack");
    for (const [service, env] of serviceEnv) {
      const key = env.names().find((name) => LOCAL_ONLY_KEYS.has(name));
      if (key !== undefined) return fail(`${key} is set in ${service}; it is for a local stack only`);
      const origin = plainOrigin(env);
      if (origin !== undefined) return fail(`${origin} in ${service} is not https`);
    }
    return pass();
  },
};
