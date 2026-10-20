// C32 (P1.38d; ADR 0031 Decision 1): under --env dev and prod, no service's environment still holds a value that starts
// with `[to fill:`. The legal pages and security.txt ship such literals (compose.dev.yaml, P2.15) until Alex writes his
// own, and a public stack must not serve them. A failure names the service in the outcome's own field and the keys in
// the reason, never a value.
import { type Check, fail, pass } from "./types.ts";

const PLACEHOLDER = "[to fill:";

export const c32: Check = {
  id: "C32",
  run: ({ env: stage, serviceEnv }) => {
    if (stage === "local") return pass("skipped: local stack");
    for (const [service, env] of serviceEnv) {
      const keys = env.names().filter((name) => env.use(name, (raw) => raw?.startsWith(PLACEHOLDER) === true));
      if (keys.length > 0) return { ...fail(`still a placeholder to fill: ${keys.join(", ")}`), service };
    }
    return pass();
  },
};
