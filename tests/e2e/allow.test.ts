import { describe, expect, test } from "vitest";
import { AXE_ALLOWANCE, expiredAllowances, unallowedViolations } from "./allow.ts";

const today = "2026-10-17";

describe("axe allowance", () => {
  test("expired_allowance_fails", () => {
    const old = { id: "color-contrast", selector: "a", reason: "fixture", expires: "2000-01-01" };
    expect(expiredAllowances([old], today)).toEqual([old]);
    expect(expiredAllowances([{ ...old, expires: "not-a-date" }], today)).toEqual([{ ...old, expires: "not-a-date" }]);
  });

  test("active_allowance_hides_only_its_selector", () => {
    const allowance = [{ id: "label", selector: "#known", reason: "fixture", expires: "2099-01-01" }];
    const violations = [
      { id: "label", nodes: [{ target: ["#known"] }, { target: ["#other"] }] },
      { id: "region", nodes: [{ target: ["#known"] }] },
    ];
    expect(unallowedViolations(violations, allowance, today)).toEqual([
      { id: "label", nodes: [{ target: ["#other"] }] },
      { id: "region", nodes: [{ target: ["#known"] }] },
    ]);
  });

  test("committed_allowance_is_the_inactive_pagination_step", () => {
    expect(AXE_ALLOWANCE.map((entry) => entry.selector)).toEqual([".off_cd8c1da0"]);
    expect(expiredAllowances(AXE_ALLOWANCE, today)).toEqual([]);
  });
});
