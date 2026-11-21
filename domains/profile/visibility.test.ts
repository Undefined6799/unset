// ADR 0078: who a member's page is shown to. Absent reads as public; a value we do not know reads as only the member,
// so a newer client's choice is never shown more widely than meant. What each viewer gets is one table.
import { validateRecord } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import { toProfileRecord } from "./profile.ts";
import { pageShownTo, parsePageVisibility, readPageVisibility, type Viewer } from "./visibility.ts";

const T = "2026-11-20T20:00:00.000Z";
const stored = { $type: "sh.unset.profile", createdAt: T, displayName: "Alice", future: 1 };

describe("page visibility", () => {
  test("reads public when absent and only the member for anything unknown", () => {
    expect(readPageVisibility(stored)).toBe("public");
    expect(readPageVisibility(null)).toBe("public");
    expect(readPageVisibility({ ...stored, visibility: "signed-in" })).toBe("signedIn");
    expect(readPageVisibility({ ...stored, visibility: "owner-only" })).toBe("ownerOnly");
    expect(readPageVisibility({ ...stored, visibility: "signedIn" })).toBe("ownerOnly");
    expect(readPageVisibility({ ...stored, visibility: "friends" })).toBe("ownerOnly");
    expect(readPageVisibility({ ...stored, visibility: 1 })).toBe("ownerOnly");
  });

  test("a save reads the choice strictly", () => {
    expect(parsePageVisibility("signedIn")).toBe("signedIn");
    expect(parsePageVisibility("friends")).toBeNull();
    expect(parsePageVisibility(["public"])).toBeNull();
  });

  test("a non-public choice is stored, public clears the field, and leaving it out keeps what was stored", () => {
    expect(toProfileRecord({ visibility: "ownerOnly" }, stored, T)).toEqual({
      ok: true,
      record: { ...stored, visibility: "owner-only" },
    });
    expect(toProfileRecord({ visibility: "public" }, { ...stored, visibility: "signed-in" }, T)).toEqual({
      ok: true,
      record: stored,
    });
    expect(toProfileRecord({ headline: "New" }, { ...stored, visibility: "friends" }, T)).toEqual({
      ok: true,
      record: { ...stored, headline: "New", visibility: "friends" },
    });
    const built = toProfileRecord({ visibility: "signedIn" }, stored, T);
    expect(built.ok && validateRecord("sh.unset.profile", built.record, "read").ok).toBe(true);
  });

  test("each viewer sees what the choice allows, and only a public page is crawlable", () => {
    const shown = (viewer: Viewer) => [
      pageShownTo("public", viewer),
      pageShownTo("signedIn", viewer),
      pageShownTo("ownerOnly", viewer),
    ];
    const page = (crawlable: boolean) => ({ kind: "page", crawlable });
    const limited = (signIn: boolean) => ({ kind: "limited", signIn });
    expect(shown("owner")).toEqual([page(true), page(false), page(false)]);
    expect(shown("member")).toEqual([page(true), page(false), limited(false)]);
    expect(shown("visitor")).toEqual([page(true), limited(true), limited(false)]);
  });
});
