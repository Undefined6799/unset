// P2.19b: a picture card's publish step inside the card writes (ADR 0070 point 5), over stand-ins for the store, the
// pictures and the PDS: the use is recorded only after the write's own checks and before anything is sent, the main
// version goes to the PDS once per Save, a write that surely did not land gives up its hold on the use, and one that
// landed settles the record's uses under its commit revision (so saves settle in any order). Types are read off
// the module under test (a test beside a route imports no domain).
import { describe, expect, test } from "vitest";
import { type CardStore, type CardWrites, cardWrites, type PictureStore } from "./card-writes.server.ts";

type ListResult = Awaited<ReturnType<CardStore["list"]>>;
type CardKey = Parameters<CardWrites["remove"]>[0];
type CardContent = Parameters<CardWrites["create"]>[0];
type CardVersion = Parameters<CardWrites["saveAll"]>[0][number]["version"];
type DraftId = Parameters<PictureStore["use"]>[0];
const OWNER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz" as Parameters<typeof cardWrites>[0];

const NOW = "2026-11-20T23:00:00.000Z";
const T1 = "2026-11-01T00:00:00.000Z";
const HEAD = "bafyhead";
const DRAFT = "0b6a52d4-6c1f-4bde-9b8e-2a1f6d7c3e01" as DraftId;
const NEW_KEY = "3kpicture2aaa" as CardKey;
const BLOB = {
  $type: "blob",
  ref: { $link: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" },
  mimeType: "image/jpeg",
  size: 3,
} as const;
const OLD = "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bvhwoxxfuknnqdpe";
const LINK = BLOB.ref.$link;
const REV = "3kcommit2aaaa";
const LEASE = "6c1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);
const ok = <T>(value: T) => ({ kind: "ok" as const, value });
const down = { kind: "transient", code: "pds_unavailable" } as const;

const picture = (draft: DraftId | null = DRAFT): CardContent => ({
  kind: "image",
  picture: draft === null ? { kind: "kept" } : { kind: "draft", id: draft },
  alt: "A lake",
  caption: "Morning",
  fit: "contain",
});
const readme = (text: string) => ({
  $type: "sh.unset.card",
  content: { $type: "sh.unset.block.text", text },
  createdAt: T1,
});
const storedPicture = {
  $type: "sh.unset.card",
  content: {
    $type: "sh.unset.block.images",
    images: [{ image: { ...BLOB, ref: { $link: OLD }, size: 9 }, alt: "Old", aspectRatio: { width: 4, height: 3 } }],
  },
  createdAt: T1,
};

type Over = {
  store?: Partial<CardStore>;
  pictures?: Partial<PictureStore>;
  cards?: { key: string; value: unknown; cid: string }[];
};

function stack(over: Over = {}) {
  const log: string[] = [];
  const written: unknown[] = [];
  const cards = over.cards ?? [{ key: "a", value: readme("A"), cid: "ca" }];
  const store: CardStore = {
    list: async () => ok({ cards, complete: true, overflow: false }) as ListResult,
    head: async () => {
      log.push("head");
      return ok(HEAD);
    },
    profile: async () => ok({ value: { $type: "sh.unset.profile", displayName: "A", createdAt: T1 }, cid: "p" }),
    page: async () => ok(null),
    newKey: () => NEW_KEY,
    write: async ({ card }) => {
      if (card?.kind === "create") written.push(card.record);
      if (card !== undefined) log.push(`${card.kind === "create" ? "create" : "remove"} ${card.key}`);
      return ok({ kind: "written", rev: REV });
    },
    save: async (key, build) => {
      const built = build(storedPicture);
      log.push(`save ${key}`);
      if (built.ok) written.push(built.record);
      return ok(built.ok ? { kind: "saved", rev: REV } : { kind: "refused", code: built.code });
    },
    saveMany: async (updates) => {
      log.push(`saveMany ${updates.map((u) => u.key).join(",")}`);
      written.push(...updates.map((u) => u.record));
      return ok({ kind: "saved", rev: REV });
    },
    saveProfile: async () => ok({ kind: "saved" }),
    ...over.store,
  };
  const pictures: PictureStore = {
    use: async (id, key) => {
      log.push(`use ${id} ${key}`);
      return { width: 2560, height: 1707, lease: LEASE };
    },
    release: async (id, key, lease) => {
      log.push(`release ${id} ${key} ${lease}`);
    },
    main: async (id) => {
      log.push(`main ${id}`);
      return { kind: "ok", bytes: JPEG };
    },
    upload: async () => {
      log.push("upload");
      return ok(BLOB);
    },
    published: async (id, link) => {
      log.push(`published ${id} ${link}`);
    },
    settle: async (key, rev, link, mine) => {
      log.push(`settle ${key} ${rev} ${link ?? "none"} ${mine.map((use) => use.id).join(",") || "-"}`);
    },
    drop: async (key) => {
      log.push(`drop ${key}`);
    },
    ...over.pictures,
  };
  return { writes: cardWrites(OWNER, store, () => NOW, pictures), log, written };
}

const PUBLISHED = {
  $type: "sh.unset.block.images",
  images: [{ image: BLOB, alt: "A lake", aspectRatio: { width: 2560, height: 1707 }, caption: "Morning" }],
  fit: "contain",
};

describe("a new picture card", () => {
  test("picture.create: checks, then the use under web's key, the upload and its CID, then the create", async () => {
    const { writes, log, written } = stack();
    expect(await writes.create(picture(), "full")).toEqual({ kind: "saved" });
    expect(log).toEqual([
      "head",
      `use ${DRAFT} ${NEW_KEY}`,
      `main ${DRAFT}`,
      "upload",
      `published ${DRAFT} ${LINK}`,
      `create ${NEW_KEY}`,
      `settle ${NEW_KEY} ${REV} ${LINK} ${DRAFT}`,
    ]);
    expect(written).toEqual([{ $type: "sh.unset.card", content: PUBLISHED, createdAt: NOW }]);
  });

  test("picture.create_once: a picture card sent again matches the stored one, its blob decoded as the client reads it", async () => {
    const first = stack();
    expect(await first.writes.create(picture(), "full", undefined, NEW_KEY)).toEqual({ kind: "saved" });
    const stored = JSON.parse(JSON.stringify(first.written[0]));
    // As @atproto/api hands back a listed record: the blob a decoded BlobRef whose toJSON gives the JSON form
    // (@atproto/lexicon blob-refs.js toJSON, ipldToJson), its keys in another order.
    const image = stored.content.images[0];
    const decoded = { size: image.image.size, mimeType: image.image.mimeType, toJSON: () => image.image };
    stored.content.images[0] = { alt: image.alt, ...image, image: decoded };
    const again = stack({ cards: [{ key: NEW_KEY, value: stored, cid: "cn" }] });
    expect(await again.writes.create(picture(), "full", undefined, NEW_KEY)).toEqual({ kind: "saved" });
    expect(again.log.some((line) => line.startsWith("create"))).toBe(false);
  });

  test("picture.create_full: a page with no room is refused before any use or upload", async () => {
    const cards = Array.from({ length: 100 }, (_, n) => ({ key: `k${n}`, value: readme("x"), cid: "c" }));
    const { writes, log } = stack({ cards });
    expect(await writes.create(picture(), "full")).toEqual({ kind: "failed", code: "card.too_many" });
    expect(log).toEqual(["head"]);
  });

  test("picture.not_theirs: a draft the member does not hold is refused on the image field, nothing sent", async () => {
    const { writes, log } = stack({ pictures: { use: async () => null } });
    expect(await writes.create(picture(), "full")).toEqual({
      kind: "failed",
      code: "card.image_missing",
      field: "image",
    });
    expect(log).toEqual(["head"]);
  });

  test.each([
    ["missing from the store", { kind: "missing" } as const, "card.image_missing"],
    ["the store down", { kind: "unavailable" } as const, "card.image_unavailable"],
  ])("picture.main_%s: the use is released and nothing is written", async (_name, answer, code) => {
    const { writes, log, written } = stack({ pictures: { main: async () => answer } });
    expect(await writes.create(picture(), "full")).toMatchObject({ kind: "failed", code });
    expect(log.at(-1)).toBe(`release ${DRAFT} ${NEW_KEY} ${LEASE}`);
    expect(written).toEqual([]);
  });

  test("picture.upload_fails: the PDS not answering releases the use and reads as its outage", async () => {
    const { writes, log, written } = stack({ pictures: { upload: async () => down } });
    expect(await writes.create(picture(), "full")).toEqual({ kind: "failed", code: "card.pds_unavailable" });
    expect(log.at(-1)).toBe(`release ${DRAFT} ${NEW_KEY} ${LEASE}`);
    expect(written).toEqual([]);
  });

  test("picture.pds_too_large: a PDS refusing the picture's size names the picture, releases the use, writes nothing", async () => {
    const tooLarge = { kind: "rejected", xrpcError: "PayloadTooLarge", status: 413 } as const;
    const sent: number[] = [];
    const upload = async (bytes: Uint8Array) => {
      sent.push(bytes.length);
      return tooLarge;
    };
    const { writes, log, written } = stack({ pictures: { upload } });
    expect(await writes.create(picture(), "full")).toEqual({
      kind: "failed",
      code: "card.image_too_large",
      field: "image",
    });
    expect(log.at(-1)).toBe(`release ${DRAFT} ${NEW_KEY} ${LEASE}`);
    // Sent once, as it was: no smaller copy is made and retried (Alex, 2026-11-21 17:43Z).
    expect(sent).toEqual([3]);
    expect(written).toEqual([]);
  });

  test("picture.note_throws: the database failing after the upload releases the use, then the error surfaces", async () => {
    const broken = new Error("database down");
    const published = async () => {
      throw broken;
    };
    const { writes, log, written } = stack({ pictures: { published } });
    await expect(writes.create(picture(), "full")).rejects.toBe(broken);
    expect(log.at(-1)).toBe(`release ${DRAFT} ${NEW_KEY} ${LEASE}`);
    expect(written).toEqual([]);
  });

  test("picture.create_unknown: a create the PDS did not answer may have landed, so its use stays", async () => {
    const { writes, log } = stack({ store: { write: async () => down } });
    expect(await writes.create(picture(), "full")).toEqual({ kind: "failed", code: "card.pds_unavailable" });
    expect(log.at(-1)).toBe(`published ${DRAFT} ${LINK}`);
    expect(log.some((line) => line.startsWith("release"))).toBe(false);
  });

  test("picture.create_changed: a repo that keeps moving uploads once and releases the use at the end", async () => {
    const { writes, log } = stack({ store: { write: async () => ok({ kind: "changed" }) } });
    expect(await writes.create(picture(), "full")).toEqual({ kind: "failed", code: "card.cards_changed" });
    expect(log.filter((line) => line === "upload")).toHaveLength(1);
    expect(log.at(-1)).toBe(`release ${DRAFT} ${NEW_KEY} ${LEASE}`);
  });

  test("picture.other_kinds: a new Text card touches no picture", async () => {
    // Web names every new card's key, so the profile's list can name it in the same write (ADR 0086 point 3).
    const { writes, log } = stack();
    await writes.create({ kind: "readme", text: "Hi" } as CardContent, "full");
    expect(log).toEqual(["head", `create ${NEW_KEY}`]);
  });
});

describe("an edited picture card", () => {
  test("picture.save_replace: a new picture is published, written, and the replaced picture's use goes", async () => {
    const { writes, log, written } = stack();
    expect(await writes.save("p" as CardKey, picture(), "full")).toEqual({ kind: "saved" });
    expect(log).toEqual([
      `use ${DRAFT} p`,
      `main ${DRAFT}`,
      "upload",
      `published ${DRAFT} ${LINK}`,
      "save p",
      `settle p ${REV} ${LINK} ${DRAFT}`,
    ]);
    expect(written).toMatchObject([{ content: PUBLISHED }]);
  });

  test("picture.save_kept: keeping the picture sends nothing and settles on the kept one", async () => {
    const { writes, log, written } = stack();
    expect(await writes.save("p" as CardKey, picture(null), "full")).toEqual({ kind: "saved" });
    expect(log).toEqual(["save p", `settle p ${REV} ${OLD} -`]);
    expect(written).toMatchObject([{ content: { images: [{ image: { size: 9 }, alt: "A lake" }] } }]);
  });

  test("picture.save_refused: a write the PDS refuses releases the new use", async () => {
    const { writes, log } = stack({ store: { save: async () => ok({ kind: "conflict" }) } });
    expect(await writes.save("p" as CardKey, picture(), "full")).toEqual({ kind: "failed", code: "card.conflict" });
    expect(log.at(-1)).toBe(`release ${DRAFT} p ${LEASE}`);
  });

  test("picture.save_unknown: a save the PDS did not answer may have landed, so no use is released", async () => {
    const { writes, log } = stack({ store: { save: async () => down } });
    expect(await writes.save("p" as CardKey, picture(), "full")).toEqual({
      kind: "failed",
      code: "card.pds_unavailable",
    });
    expect(log.some((line) => /^(release|settle|drop)/.test(line))).toBe(false);
  });

  test("picture.save_same_failed: re-sending the card's own picture gives up only its own hold when the save fails", async () => {
    // The stored card's use is settled, so the store keeps it (image.release_lease in image-store.test.ts).
    const { writes, log } = stack({ pictures: { upload: async () => down } });
    expect(await writes.save("p" as CardKey, picture(), "full")).toEqual({
      kind: "failed",
      code: "card.pds_unavailable",
    });
    expect(log.filter((line) => line.startsWith("release"))).toEqual([`release ${DRAFT} p ${LEASE}`]);
  });

  test("picture.save_two_tabs: each landed save settles under its own commit revision, in any order", async () => {
    // Tab A writes and stalls before settling; tab B writes over A's record and settles first. Each names its own
    // revision and the picture its record shows, so the store can keep the newer one (image.settle_* in
    // tests/integration/postgres/image-store.test.ts proves the order there).
    const { promise: stalled, resolve: stall } = Promise.withResolvers<void>();
    let saves = 0;
    const second = "5f0c1a9e-2d3b-4c4d-8e5f-6a7b8c9d0e02" as DraftId;
    const links: Record<string, string> = {
      [DRAFT]: LINK,
      [second]: "bafkreibqx3ukiz5avmi372ivipzcfectju7nbqtpalxw6mrn4xqtp6bbzu",
    };
    let next = "";
    const tab = stack({
      store: {
        save: async (_key, build) => {
          const built = build(storedPicture);
          if (!built.ok) return ok({ kind: "refused", code: built.code });
          saves += 1;
          const rev = saves === 1 ? "3kcommit2aaaa" : "3kcommit2bbbb";
          if (saves === 1) await stalled;
          return ok({ kind: "saved", rev });
        },
      },
      pictures: {
        main: async (id) => {
          next = links[id] ?? "";
          return { kind: "ok", bytes: JPEG };
        },
        upload: async () => ok({ ...BLOB, ref: { $link: next } }),
      },
    });
    const a = tab.writes.save("p" as CardKey, picture(), "full");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await tab.writes.save("p" as CardKey, picture(second), "full")).toEqual({ kind: "saved" });
    stall();
    expect(await a).toEqual({ kind: "saved" });
    expect(tab.log.filter((line) => line.startsWith("settle"))).toEqual([
      `settle p 3kcommit2bbbb ${links[second]} ${second}`,
      `settle p 3kcommit2aaaa ${LINK} ${DRAFT}`,
    ]);
  });

  test("picture.save_no_rev: a landed save the PDS gave no revision settles nothing, so its uses stay", async () => {
    const { writes, log } = stack({ store: { save: async () => ok({ kind: "saved" }) } });
    expect(await writes.save("p" as CardKey, picture(), "full")).toEqual({ kind: "saved" });
    expect(log.some((line) => /^(release|settle|drop)/.test(line))).toBe(false);
  });

  test("picture.remove: deleting a card drops every use its record had", async () => {
    const { writes, log } = stack({ cards: [{ key: "p", value: storedPicture, cid: "cp" }] });
    expect(await writes.remove("p" as CardKey)).toEqual({ kind: "saved" });
    expect(log).toEqual(["head", "remove p", "drop p"]);
  });
});

describe("a Save with pictures", () => {
  const cards = [
    { key: "p", value: storedPicture, cid: "cp" },
    { key: "a", value: readme("A"), cid: "ca" },
  ];
  const edit = (key: string, content: CardContent, version: string) => ({
    key: key as CardKey,
    version: version as CardVersion,
    content,
    width: "full" as const,
  });

  test("picture.save_all: the checks pass first, then the use and upload, one applyWrites, then the old use goes", async () => {
    const { writes, log } = stack({ cards });
    const edits = [edit("p", picture(), "cp"), edit("a", { kind: "readme", text: "B" } as CardContent, "ca")];
    expect(await writes.saveAll(edits)).toEqual({ kind: "saved" });
    expect(log).toEqual([
      "head",
      `use ${DRAFT} p`,
      `main ${DRAFT}`,
      "upload",
      `published ${DRAFT} ${LINK}`,
      "saveMany p,a",
      `settle p ${REV} ${LINK} ${DRAFT}`,
      `settle a ${REV} none -`,
    ]);
  });

  test("picture.save_all_conflict: a card changed elsewhere stops the Save before any use or upload", async () => {
    const { writes, log } = stack({ cards });
    const result = await writes.saveAll([edit("p", picture(), "stale")]);
    expect(result).toEqual({ kind: "failed", code: "card.conflict", card: "p" });
    expect(log).toEqual(["head"]);
  });

  test("picture.save_all_retry: a head that moved is read again, and the picture is not sent twice", async () => {
    let calls = 0;
    const { writes, log } = stack({
      cards,
      store: { saveMany: async () => ok(++calls === 1 ? { kind: "changed" } : { kind: "saved", rev: REV }) },
    });
    expect(await writes.saveAll([edit("p", picture(), "cp")])).toEqual({ kind: "saved" });
    expect(log.filter((line) => line.startsWith("use") || line === "upload")).toEqual([`use ${DRAFT} p`, "upload"]);
    expect(log.at(-1)).toBe(`settle p ${REV} ${LINK} ${DRAFT}`);
  });

  test("picture.save_all_partial: the written card settles; one the PDS may still have written keeps its use", async () => {
    const both = [...cards, { key: "q", value: storedPicture, cid: "cq" }];
    const second = "5f0c1a9e-2d3b-4c4d-8e5f-6a7b8c9d0e02" as DraftId;
    const { writes, log } = stack({
      cards: both,
      store: { saveMany: async () => ok({ kind: "partial", saved: ["p"], rev: REV }) },
    });
    const result = await writes.saveAll([edit("p", picture(), "cp"), edit("q", picture(second), "cq")]);
    expect(result).toMatchObject({ kind: "failed", code: "card.save_partial", saved: ["p"] });
    expect(log.at(-1)).toBe(`settle p ${REV} ${LINK} ${DRAFT}`);
    expect(log.some((line) => line.startsWith("release"))).toBe(false);
  });

  test("picture.save_all_too_large: nothing written releases every new use", async () => {
    const { writes, log } = stack({ cards, store: { saveMany: async () => ok({ kind: "too_large", key: "p" }) } });
    expect(await writes.saveAll([edit("p", picture(), "cp")])).toMatchObject({ code: "card.save_too_large" });
    expect(log.at(-1)).toBe(`release ${DRAFT} p ${LEASE}`);
  });

  test("picture.save_all_throws: a later picture's database failure releases the uses made before it", async () => {
    const second = "5e1d0c2b-7a3f-4c6e-8d9b-1f2a3b4c5d6e" as DraftId;
    const broken = new Error("database down");
    const both = [...cards, { key: "q", value: storedPicture, cid: "cq" }];
    const { writes, log } = stack({
      cards: both,
      pictures: {
        published: async (id) => {
          if (id === second) throw broken;
          log.push(`published ${id}`);
        },
      },
    });
    const edits = [edit("p", picture(), "cp"), edit("q", picture(second), "cq")];
    await expect(writes.saveAll(edits)).rejects.toBe(broken);
    expect(log.filter((line) => line.startsWith("release"))).toEqual([
      `release ${second} q ${LEASE}`,
      `release ${DRAFT} p ${LEASE}`,
    ]);
    expect(log.some((line) => line.startsWith("saveMany"))).toBe(false);
  });

  test("picture.kind_changed: a picture card saved as Text settles with no picture, so its use goes", async () => {
    const { writes, log } = stack({ cards });
    await writes.saveAll([edit("p", { kind: "readme", text: "Now words" } as CardContent, "cp")]);
    expect(log.at(-1)).toBe(`settle p ${REV} none -`);
  });
});
