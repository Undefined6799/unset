// C31 (P1.37v; ADR 0030 Decision 2): Newt's env file holds exactly its three names, as C30 holds pds.env, so no
// unreviewed setting rides in beside its credentials; every other Newt setting is a compose literal. Under dev Newt is
// the edge's only way in, so the stack must run it; local runs none, and prod has no ruling yet, so either may leave it
// out. Names only; a value is never read.
import { type Check, fail, pass } from "./types.ts";

/** What newt.env holds: Pangolin's address and the site's two credentials (newt 1.18.1 newtconfig/newtconfig.go). */
const NEWT_ENV = ["PANGOLIN_ENDPOINT", "NEWT_ID", "NEWT_SECRET"];
/** A name C31 may print: one of ours. Anything else in a key slot might be a pasted value, so it is not named. */
const PRINTABLE = /^(?:NEWT|PANGOLIN)_[A-Z0-9_]+$/;

export const c31: Check = {
  id: "C31",
  run: ({ env: stage, envFileNames, compose }) => {
    const newt = compose.services.find((s) => s.name === "newt");
    if (newt === undefined)
      return stage === "dev" ? fail("no newt service; under dev it is the edge's only way in") : pass();
    // One file holds the set, so its names cannot be split across a second, unreviewed one.
    if (newt.envFiles.length !== 1)
      return fail(`the newt service reads ${newt.envFiles.length} env files, not exactly one`);
    // Compose's environment wins over env_file, so a name of the set written there would shadow newt.env's value.
    const inCompose = newt.environment.find(([name]) => NEWT_ENV.includes(name));
    if (inCompose !== undefined) return fail(`${inCompose[0]} is set in the newt service's environment, not newt.env`);
    const names = envFileNames.get("newt") ?? [];
    const label = (name: string) => (PRINTABLE.test(name) ? name : "a name");
    const repeated = names.find((name, i) => names.indexOf(name) !== i);
    if (repeated !== undefined) return fail(`${label(repeated)} is repeated in the newt env file`);
    const extra = names.find((name) => !NEWT_ENV.includes(name));
    if (extra !== undefined) return fail(`${label(extra)} is in the newt env file, which holds only its three names`);
    const missing = NEWT_ENV.find((name) => !names.includes(name));
    return missing === undefined ? pass() : fail(`${missing} is missing from the newt env file`);
  },
};
