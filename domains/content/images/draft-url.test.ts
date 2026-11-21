import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { DRAFT_URL_MAX_AHEAD_S, type DraftUrlKeys, mintDraftPath, verifyDraftPath } from "./draft-url.ts";

const keyOf = (fill: number) => new Uint8Array(32).fill(fill);
const keys = (active: string, held: Record<string, Uint8Array>): DraftUrlKeys => ({
  active,
  key: (kid) => held[kid],
});
const KEYS = keys("k1", { k1: keyOf(1), k2: keyOf(2) });
const OBJECT = "drafts/did:plc:abcdefghijklmnopqrstuvwx/i/0b8e0b8e-1111-4222-8333-444455556666/w960.avif";
const NOW = 1_800_000_000;

const parts = (path: string) => {
  const url = new URL(path, "https://media.test");
  return { pathname: url.pathname, query: url.searchParams };
};
// The raw request target, as node:http gives it: never normalised by a URL parser, so `%2e%2e` stays as sent.
const verify = (target: string, now = NOW, held = KEYS) => verifyDraftPath(held, target, now);
const swap = (target: string, name: string, value: string) => {
  const [path = "", search = ""] = target.split("?");
  const query = new URLSearchParams(search);
  query.set(name, value);
  return `${path}?${query}`;
};

describe("signed draft links (book P2.19)", () => {
  test("signedUrl.round_trip: a minted link verifies and names its object", () => {
    const path = mintDraftPath(KEYS, OBJECT, NOW);
    expect(path.startsWith(`/o/draft-preview/${OBJECT}?exp=`)).toBe(true);
    expect(verify(path)).toEqual({ ok: true, objectKey: OBJECT, exp: expect.any(Number) });
  });

  test("signedUrl.format: exp rounds up to the minute and the MAC covers v1, purpose, kid, key and exp", () => {
    const { query } = parts(mintDraftPath(KEYS, OBJECT, NOW + 1));
    const exp = Math.ceil((NOW + 1 + 300) / 60) * 60;
    expect(query.get("exp")).toBe(String(exp));
    expect(query.get("kid")).toBe("k1");
    const msg = `v1\ndraft-preview\nk1\n${OBJECT}\n${exp}`;
    expect(query.get("sig")).toBe(createHmac("sha256", keyOf(1)).update(msg).digest("base64url"));
  });

  test("signedUrl.tamper: a changed exp, kid, sig or object fails", () => {
    const path = mintDraftPath(KEYS, OBJECT, NOW);
    const exp = Number(parts(path).query.get("exp"));
    expect(verify(swap(path, "exp", String(exp + 60)))).toEqual({ ok: false });
    expect(verify(swap(path, "kid", "k2"))).toEqual({ ok: false });
    expect(verify(swap(path, "sig", "A".repeat(43)))).toEqual({ ok: false });
    expect(verify(swap(path, "sig", "short"))).toEqual({ ok: false });
    expect(verify(swap(path, "sig", `${parts(path).query.get("sig")}!`))).toEqual({ ok: false });
    expect(verify(path.replace("w960.avif", "w480.avif"))).toEqual({ ok: false });
  });

  test("signedUrl.purpose_bound: the same MAC under another purpose's path fails", () => {
    const path = mintDraftPath(KEYS, OBJECT, NOW);
    expect(verify(path.replace("/o/draft-preview/", "/o/admin-thumb/"))).toEqual({ ok: false });
  });

  test("signedUrl.expired: past exp, or more than ten minutes ahead, fails", () => {
    const path = mintDraftPath(KEYS, OBJECT, NOW);
    const exp = Number(parts(path).query.get("exp"));
    expect(verify(path, exp).ok).toBe(true);
    expect(verify(path, exp + 1)).toEqual({ ok: false });
    const far = mintDraftPath(KEYS, OBJECT, NOW, DRAFT_URL_MAX_AHEAD_S + 60);
    expect(verify(far)).toEqual({ ok: false });
  });

  test("signedUrl.rotation: an old kid still held verifies; one dropped fails", () => {
    const old = mintDraftPath(keys("k2", { k2: keyOf(2) }), OBJECT, NOW);
    expect(verify(old).ok).toBe(true);
    expect(verify(old, NOW, keys("k1", { k1: keyOf(1) }))).toEqual({ ok: false });
  });

  test("signedUrl.query_exact: a missing, repeated or extra parameter fails", () => {
    const path = mintDraftPath(KEYS, OBJECT, NOW);
    expect(verify(`${path}&x=1`)).toEqual({ ok: false });
    expect(verify(`${path}&kid=k1`)).toEqual({ ok: false });
    expect(verify(path.replace(/&kid=k1/, ""))).toEqual({ ok: false });
    expect(verify(swap(path, "exp", "1e9"))).toEqual({ ok: false });
  });

  test("media.key_outside_prefix: keys outside drafts, traversal and other shapes fail, and are never minted", () => {
    const signedFor = (objectKey: string) => {
      const exp = Math.ceil((NOW + 300) / 60) * 60;
      const sig = createHmac("sha256", keyOf(1))
        .update(`v1\ndraft-preview\nk1\n${objectKey}\n${exp}`)
        .digest("base64url");
      return `/o/draft-preview/${objectKey}?exp=${exp}&kid=k1&sig=${sig}`;
    };
    const did = "did:plc:abcdefghijklmnopqrstuvwx";
    const id = "0b8e0b8e-1111-4222-8333-444455556666";
    for (const bad of [
      `legal-hold/${did}/i/${id}/main.jpeg`,
      `media/${did}/i/${id}/main.jpeg`,
      `drafts/${did}/i/${id}/../main.jpeg`,
      `drafts/${did}/i/%2e%2e/main.jpeg`,
      `drafts/${did}/i/${id}/main.png`,
      `drafts/did:plc:short/i/${id}/main.jpeg`,
      `drafts/${did}/i/${id}/sub/main.jpeg`,
    ]) {
      expect(verify(signedFor(bad)), bad).toEqual({ ok: false });
      expect(() => mintDraftPath(KEYS, bad, NOW), bad).toThrow(TypeError);
    }
    expect(verify(signedFor(`drafts/did:web:example.com/i/${id}/main.jpeg`)).ok).toBe(true);
  });

  test("signedUrl.unknown_path: anything but /o/<purpose>/<key> fails", () => {
    expect(verify("/x/draft-preview/a")).toEqual({ ok: false });
    expect(verify("/o/")).toEqual({ ok: false });
  });
});
