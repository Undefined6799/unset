// Property test for the chooser's server check (P1.36v, TE-6; verify-1131 N2): a server URL that is not exactly our
// PDS's issuer is refused before the library is asked anything, whatever its spelling.
import type { Logger } from "@unset/shared-log";
import fc from "fast-check";
import { expect, test } from "vitest";
import { authorize } from "./sign-in.ts";

const OURS = "https://staging.unset.ac";
const silent: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  logError: () => undefined,
};

/** Spellings near ours: case, slashes, ports, userinfo, dots, paths, encodings, other schemes. */
const NEAR = ["https://", "http://", "HTTPS://", "staging.unset.ac", "STAGING.unset.ac", "/", ".", ":443", ":", "@"];
const piece = fc.oneof(
  fc.constantFrom(...NEAR, "%2e", "evil.example", "\t", " ", "?", "#"),
  fc.string({ maxLength: 3 }),
);
const server = fc.oneof(
  fc.array(piece, { minLength: 1, maxLength: 6 }).map((parts) => `https://${parts.join("")}`),
  fc.array(piece, { minLength: 1, maxLength: 6 }).map((parts) => `http://${parts.join("")}`),
  fc.webUrl(),
);

test("fuzz_chooser_server_other_than_ours_asks_nothing", async () => {
  await fc.assert(
    fc.asyncProperty(server, async (input) => {
      fc.pre(input !== OURS);
      let asked = 0;
      const client = {
        authorize: async () => {
          asked += 1;
          throw new Error("the library was asked");
        },
      };
      const result = await authorize(client, input, { appState: "s", deadline: null, ownIssuer: OURS, log: silent });
      expect(result).toEqual({ ok: false, reason: "account_elsewhere" });
      expect(asked).toBe(0);
    }),
    { numRuns: 5_000 },
  );
});
