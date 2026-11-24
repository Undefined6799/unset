// P2.19b: the picture store a card write uses (card-writes.server.ts `PictureStore`), bound to one member: their own
// uploads, their own card records and their own PDS (rule SE-2). Every call names their DID, and a record URI is
// built here from a card key, never taken from the form.
import type { Did } from "@unset/domains-identity";
import { CARD_COLLECTION, type PdsResult, type UploadedBlob } from "@unset/infrastructure-pds";
import type { ObjectStore } from "@unset/infrastructure-storage";
import type { PictureStore } from "./card-writes.server.ts";

/**
 * How long taking a use back may take once the write is decided. Its own deadline, not the request's: a request that
 * ran out of time while reading the store or uploading must still take back what it recorded, or the use would keep
 * the image from the sweep for good (RE-1: one short, bounded step; the pool's connect timeout nests inside it).
 */
export const SETTLE_MS = 5_000;

/** The image library calls this file makes (infrastructure/postgres ImageStore, wired in compose.ts). */
type HeldUse = { readonly id: string; readonly lease: string };
type ImageUses = {
  readonly addUse: (
    did: Did,
    id: string,
    recordUri: string,
    deadline: AbortSignal,
  ) => Promise<{
    readonly width: number;
    readonly height: number;
    readonly created: boolean;
    readonly lease: string;
  } | null>;
  readonly removeUse: (did: Did, id: string, recordUri: string, lease: string, deadline: AbortSignal) => Promise<void>;
  readonly notePublished: (did: Did, id: string, blobCid: string, deadline: AbortSignal) => Promise<void>;
  readonly settleUse: (
    did: Did,
    recordUri: string,
    rev: string,
    shownCid: string | null,
    mine: readonly HeldUse[],
    deadline: AbortSignal,
  ) => Promise<void>;
  readonly dropUses: (did: Did, recordUri: string, deadline: AbortSignal) => Promise<void>;
};

export type PictureDeps = {
  /** Closed where no inspection is mounted (production for now, ADR 0070 point 7): no picture is published. */
  readonly images: {
    readonly open: boolean;
    readonly store: ImageUses;
  };
  readonly drafts: Pick<ObjectStore, "get">;
  readonly upload: (bytes: Uint8Array) => Promise<PdsResult<UploadedBlob>>;
};

export function picturesFor(did: Did, deps: PictureDeps, deadline: AbortSignal): PictureStore {
  const { images, drafts } = deps;
  const uri = (key: string) => `at://${did}/${CARD_COLLECTION}/${key}`;
  const settling = () => AbortSignal.timeout(SETTLE_MS);
  return {
    use: async (id, key) => (images.open ? images.store.addUse(did, id, uri(key), deadline) : null),
    release: (id, key, lease) => images.store.removeUse(did, id, uri(key), lease, settling()),
    main: async (id) => {
      // The main version, a WebP since ADR 0088 (domains/content standard.ts); an older JPEG draft reads as missing.
      const read = await drafts.get(`drafts/${did}/i/${id}/main.webp`);
      if (!read.ok) return { kind: "unavailable" };
      return read.bytes === null ? { kind: "missing" } : { kind: "ok", bytes: read.bytes };
    },
    upload: deps.upload,
    published: (id, link) => images.store.notePublished(did, id, link, deadline),
    settle: (key, rev, link, mine) => images.store.settleUse(did, uri(key), rev, link, mine, settling()),
    drop: (key) => images.store.dropUses(did, uri(key), settling()),
  };
}
