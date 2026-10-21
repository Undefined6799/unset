// C32 (P1.38d; ADR 0031 Decision 1): under --env dev and prod, no service's environment still holds a value that starts
// with `[to fill:`. Such literals mark a value Alex has not written yet (the legal pages' values were, until P1.36c
// put his staging ones in compose.dev.yaml), and a public stack must not serve them. A failure names the service in
// the outcome's own field and the keys in the reason, never a value.
import { type Check, fail, pass } from "./types.ts";

const PLACEHOLDER = "[to fill:";
/** An env file's key is caller input, so only an upper-case setting name is printed (as C31 does). */
const PRINTABLE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const label = (name: string) => (PRINTABLE.test(name) && name.length <= 64 ? name : "a name");

export const c32: Check = {
  id: "C32",
  run: ({ env: stage, serviceEnv }) => {
    if (stage === "local") return pass("skipped: local stack");
    for (const [service, env] of serviceEnv) {
      const keys = env.names().filter((name) => env.use(name, (raw) => raw?.startsWith(PLACEHOLDER) === true));
      if (keys.length > 0) return { ...fail(`still a placeholder to fill: ${keys.map(label).join(", ")}`), service };
    }
    return pass();
  },
};
