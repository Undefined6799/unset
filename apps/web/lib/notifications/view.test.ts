import { describe, expect, test } from "vitest";
import { howLongAgo } from "./view.ts";

describe("how long ago", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const before = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

  test("sign_ins.how_long_ago_reads_in_the_largest_whole_unit", () => {
    expect(howLongAgo(before(30), now)).toBe("just now");
    expect(howLongAgo(before(60), now)).toBe("1 minute ago");
    expect(howLongAgo(before(3 * 3600 + 59 * 60), now)).toBe("3 hours ago");
    expect(howLongAgo(before(86_400), now)).toBe("yesterday");
    expect(howLongAgo(before(29 * 86_400), now)).toBe("4 weeks ago");
  });
});
