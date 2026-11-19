// C32 (P1.38d; ADR 0031 Decision 1): under --env dev and prod, no service's environment still holds a value that starts
// with `[to fill:`. Such literals mark a value Alex has not written yet (the legal pages' values were, until P1.36c
// put his staging ones in compose.dev.yaml), and a public stack must not serve them. A failure names the service in
// the outcome's own field and the keys in the reason, never a value.
import { type Check, fail, pass } from "./types.ts";

const PLACEHOLDER = "[to fill:";
/**
 * An env file's key is caller input, even a pasted token, so only the legal pages' three settings
 * (interfaces/http/legal-placeholders.ts) are printed by name.
 */
const PRINTABLE = new Set(["PRIVACY_OFFICER_TITLE", "PRIVACY_OFFICER_CONTACT", "SUPPORT_EMAIL"]);
const label = (name: string) => (PRINTABLE.has(name) ? name : "a name");

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

/**
 * C34 (P2.10, review N1 of #1733): every name the Compose files interpolate has a value in the interpolation env file.
 * Compose turns a missing name into an empty string with only a warning (compose-spec 12-interpolation.md), so a
 * setting a new step adds (WEB_PDS_ADMIN_KID, say) would reach the service empty and stop it at boot, after the old
 * containers were replaced. The preflight runs before `compose up`, so the deploy stops here instead. The reason names
 * the Compose variables, which come from the committed files, never a value.
 */
export const c34: Check = {
  id: "C34",
  run: ({ emptyInterpolated }) =>
    emptyInterpolated.length === 0
      ? pass()
      : fail(`the interpolation env file gives no value for ${emptyInterpolated.join(", ")}`),
};
