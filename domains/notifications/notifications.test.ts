import { describe, expect, test } from "vitest";
import {
  COUNT_CAP,
  DISMISS_MAX,
  type Entry,
  type Inbox,
  inboxList,
  listOf,
  type Notification,
  type NotificationId,
  notify,
  parseNotificationId,
  parseNotificationIds,
} from "./notifications.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as NotificationId;
const entry = (n: number, seen = false): Entry => ({
  id: id(n),
  reason: "sign_in",
  topic: null,
  sentAt: new Date(n * 1000),
  seen,
});

function inboxOf(count: number): Inbox & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    list: async (limit) => {
      asked.push(limit);
      return Array.from({ length: Math.min(count, limit) }, (_, i) => entry(count - i));
    },
    dismiss: async () => [],
    dismissUpTo: async () => [],
    markSeen: async () => undefined,
  };
}

describe("notifications", () => {
  test("ids.a_dismiss_form_keeps_valid_ids_once_and_at_most_the_page", () => {
    expect(parseNotificationIds([id(1), "x", id(2), id(1), "", `${id(3)} `])).toEqual([id(1), id(2)]);
    const many = Array.from({ length: DISMISS_MAX + 5 }, (_, n) => id(n + 1));
    expect(parseNotificationIds(many)).toEqual(many.slice(0, DISMISS_MAX));
    expect(parseNotificationIds([])).toEqual([]);
  });

  test("ids.only_a_lowercase_uuid_parses", () => {
    expect(parseNotificationId(id(1))).toBe(id(1));
    for (const bad of [
      null,
      "",
      "1",
      "0000000A-0000-4000-8000-000000000001",
      `${id(1)} `,
      "00000000-0000-4000-8000-00000000000g",
    ]) {
      expect(parseNotificationId(bad)).toBeNull();
    }
  });

  test("notify.stores_a_valid_notification_once", async () => {
    const sent: Notification[] = [];
    const result = await notify(
      { insert: async (n) => void sent.push(n) },
      { reason: "privacy_notice", topic: "2026-11-01", dedupeKey: "privacy_notice:2026-11-01" },
    );
    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
  });

  test("notify.refuses_an_unknown_reason_or_a_bad_key_and_stores_nothing", async () => {
    const sent: Notification[] = [];
    const outbox = { insert: async (n: Notification) => void sent.push(n) };
    const bad = [
      { reason: "chat" },
      { reason: "sign_in", topic: "" },
      { reason: "sign_in", topic: "a b" },
      { reason: "sign_in", topic: "x".repeat(65) },
      { reason: "sign_in", dedupeKey: "x".repeat(129) },
      { reason: "sign_in", dedupeKey: "é" },
    ] as Notification[];
    for (const notification of bad) {
      expect(await notify(outbox, notification)).toEqual({ ok: false, error: "notification_invalid" });
    }
    expect(sent).toEqual([]);
  });

  test("list.reads_one_more_than_it_shows_and_caps_the_count", async () => {
    const inbox = inboxOf(30);
    const list = await inboxList(inbox, 5);
    expect(inbox.asked).toEqual([COUNT_CAP + 1]);
    expect(list.entries.map((e) => e.id)).toEqual([id(30), id(29), id(28), id(27), id(26)]);
    expect(list.count).toBe(COUNT_CAP);
    expect(list.more).toBe(true);
  });

  test("list.counts_exactly_below_the_cap", async () => {
    const list = await inboxList(inboxOf(3), 5);
    expect(list).toMatchObject({ count: 3, more: false });
    expect(list.entries).toHaveLength(3);
  });

  test("list.counts_only_what_this_browser_has_not_seen", () => {
    // Opening the bell or the page marks what it showed as seen in this browser (ADR 0085): the badge counts the
    // newer ones only, and the seen ones stay listed until they are dismissed.
    const read = [entry(9), entry(8), entry(7, true), entry(6, true)];
    expect(listOf(read, 5)).toMatchObject({ count: 2, more: false });
    expect(listOf(read, 5).entries).toHaveLength(4);
    expect(listOf([entry(2, true), entry(1, true)], 5).count).toBe(0);
  });

  test("list.the_page_reads_past_its_own_limit", async () => {
    const inbox = inboxOf(60);
    const list = await inboxList(inbox, 50);
    expect(inbox.asked).toEqual([51]);
    expect(list).toMatchObject({ count: COUNT_CAP, more: true });
  });
});
