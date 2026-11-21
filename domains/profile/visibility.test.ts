// ADR 0078: who a member's page is shown to, kept on the main page record (ADR 0091). Absent reads as public; a value we do not know reads as only the member,
// so a newer client's choice is never shown more widely than meant. What each viewer gets is one table.
import { validateRecord } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import { withVisibility } from "./page.ts";
import { toProfileRecord } from "./profile.ts";
import { pageShownTo, parsePageVisibility, readPageVisibility, type Viewer } from "./visibility.ts";

const T = "2026-11-20T20:00:00.000Z";
const stored = { $type: "sh.unset.profile", createdAt: T, displayName: "Alice", future: 1 };
const storedPage = { $type: "sh.unset.page", createdAt: T, future: 1 };

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

  test("a non-public choice is stored on the page, public clears it, and the rest of the page is kept", () => {
    const cards = [{ uri: "at://did:plc:alice/sh.unset.card/3jzfcijpj2z2a" }];
    expect(withVisibility("ownerOnly", storedPage, T)).toEqual({
      ok: true,
      record: { ...storedPage, visibility: "owner-only" },
    });
    expect(withVisibility("public", { ...storedPage, cards, visibility: "signed-in" }, T)).toEqual({
      ok: true,
      record: { ...storedPage, cards },
    });
    // A first choice starts a page with no cards.
    expect(withVisibility("signedIn", null, T)).toEqual({
      ok: true,
      record: { $type: "sh.unset.page", visibility: "signed-in", createdAt: T },
    });
    const built = withVisibility("signedIn", storedPage, T);
    expect(built.ok && validateRecord("sh.unset.page", built.record, "read").ok).toBe(true);
  });

  test("the profile no longer carries the choice: a profile save neither sets nor reads it", () => {
    expect(toProfileRecord({ headline: "New" }, stored, T)).toEqual({
      ok: true,
      record: { ...stored, headline: "New" },
    });
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
