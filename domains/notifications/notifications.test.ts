import { describe, expect, test } from "vitest";
import { COUNT_CAP, notificationsFor, parseSignInAt, type SignInAt } from "./notifications.ts";

const at = (n: number): SignInAt => `2026-11-20T20:${String(n).padStart(2, "0")}:00.123456Z` as SignInAt;
const times = (n: number): SignInAt[] => Array.from({ length: n }, (_, i) => at(59 - i));

describe("parseSignInAt", () => {
  test("accepts_the_store_shape_with_microseconds", () => {
    expect(parseSignInAt("2026-11-20T20:02:59.123456Z")).toBe("2026-11-20T20:02:59.123456Z");
  });

  test.each([
    null,
    "",
    "2026-11-20T20:02:59.123Z",
    "2026-11-20T20:02:59Z",
    "2026-11-20 20:02:59.123456+00",
    "2026-13-40T20:02:59.123456Z",
    "2026-11-20T20:02:59.123456Z ",
    "9999-11-20T20:02:59.123456Z\n",
  ])("refuses_%j", (raw) => {
    expect(parseSignInAt(raw)).toBeNull();
  });
});

describe("notificationsFor", () => {
  test("lists_the_privacy_notice_first_then_sign_ins_newest_first", async () => {
    const list = await notificationsFor({ signIns: async () => [at(3), at(1)], privacyNotice: "2026-11-01" }, 5);
    expect(list.entries).toEqual([
      { kind: "privacy_notice", version: "2026-11-01" },
      { kind: "sign_in", at: at(3) },
      { kind: "sign_in", at: at(1) },
    ]);
    expect(list.unread).toBe(3);
    expect(list.more).toBe(false);
  });

  test("an_empty_list_counts_nothing", async () => {
    const list = await notificationsFor({ signIns: async () => [], privacyNotice: null }, 5);
    expect(list).toEqual({ entries: [], unread: 0, more: false });
  });

  test("the_bell_shows_five_and_counts_up_to_the_cap", async () => {
    let asked = 0;
    const list = await notificationsFor(
      {
        signIns: async (limit) => {
          asked = limit;
          return times(limit);
        },
        privacyNotice: null,
      },
      5,
    );
    expect(asked).toBe(COUNT_CAP + 1);
    expect(list.entries).toHaveLength(5);
    expect(list.unread).toBe(COUNT_CAP);
    expect(list.more).toBe(true);
  });

  test("the_page_reads_one_more_than_it_shows", async () => {
    let asked = 0;
    const list = await notificationsFor(
      {
        signIns: async (limit) => {
          asked = limit;
          return times(50);
        },
        privacyNotice: "v2",
      },
      50,
    );
    expect(asked).toBe(51);
    expect(list.entries).toHaveLength(50);
    expect(list.more).toBe(true);
  });
});
