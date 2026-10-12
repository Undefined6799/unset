// P1.30w: what scrubbed lets out of a check's reason (architecture ruling B2b).
import { describe, expect, test } from "vitest";
import { SecretMap } from "../secret-map.ts";
import { fail, scrubbed } from "./types.ts";

describe("scrubbed (P1.30w)", () => {
  test("scrubbed_turns_values_into_names", () => {
    const env = new SecretMap([
      ["HOST", "pds.example.test"],
      ["UPSTREAM", "pds.example.test:3000"],
      ["EMPTY", ""],
    ]);
    // The longer value goes first, so the upstream is named whole; an empty or absent value changes nothing.
    expect(
      scrubbed(fail("pds.example.test:3000 and pds.example.test"), env, ["HOST", "UPSTREAM", "EMPTY", "NONE"]),
    ).toEqual(fail("UPSTREAM and HOST"));
  });

  test("scrubbed_withholds_a_reason_that_still_holds_a_value", () => {
    // Naming HOST's value writes out UPSTREAM's value, so the reason cannot leave at all.
    const env = new SecretMap([
      ["HOST", "h"],
      ["UPSTREAM", "HOST"],
    ]);
    expect(scrubbed(fail("h"), env, ["HOST", "UPSTREAM"])).toEqual(
      fail("the reason is withheld: it would print a value"),
    );
  });
});
