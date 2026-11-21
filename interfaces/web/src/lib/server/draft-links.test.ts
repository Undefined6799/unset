// Web's half of the draft previews (book P2.19): the link it mints for a member's own version is one media accepts,
// on the media origin, and it never mints one for a key outside that member's drafts.
import { verifyDraftPath } from "@unset/domains-content";
import type { Did } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import { draftLinks } from "./draft-links.ts";

const KEYS = { active: "d1", key: (kid: string) => (kid === "d1" ? new Uint8Array(32).fill(3) : undefined) };
const DID = "did:plc:abcdefghijklmnopqrstuvwx" as Did;
const ID = "0b8e0b8e-1111-4222-8333-444455556666";
const NOW = 1_800_000_000;
const link = draftLinks(KEYS, "https://usercontent.unset.site", () => NOW);

describe("draft links", () => {
  test("draft_links.media_accepts: the link is on the media origin and names the member's own version", () => {
    const url = new URL(link(DID, ID, "w960.avif"));
    expect(url.origin).toBe("https://usercontent.unset.site");
    expect(verifyDraftPath(KEYS, `${url.pathname}${url.search}`, NOW)).toEqual({
      ok: true,
      objectKey: `drafts/${DID}/i/${ID}/w960.avif`,
      exp: expect.any(Number),
    });
  });

  test("draft_links.refuses_other_shapes: an id or version that is not ours throws instead of minting", () => {
    expect(() => link(DID, "../other", "w960.avif")).toThrow(TypeError);
    expect(() => link(DID, ID, "../../x/main.jpeg")).toThrow(TypeError);
    expect(() => link(DID, ID, "main.png")).toThrow(TypeError);
  });
});
