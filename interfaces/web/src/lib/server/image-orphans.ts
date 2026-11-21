// The orphan-object sweep (book P2.19b, second half; ADR 0070 point 6): objects under `drafts/` that no image row
// names, left when a sweep's or an upload's delete failed. Why it is safe without an age check: an upload writes its
// row before any object (routes/images/upload.server.ts), the row sweep deletes rows before objects (compose.ts
// sweepImages), and every id is a new random UUID. So a folder listed first, whose row is missing when the rows are
// read afterwards, has no row and never will; a row deleted after that read only waits for the next run.
import { sweepAllowed } from "@unset/domains-content";
import { type Did, parseDid } from "@unset/domains-identity";

type Done<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly code: "objects.unavailable" };

/** web's object store, as far as this sweep uses it (infrastructure/storage ObjectStore). */
export type DraftObjects = {
  list(prefix: string): Promise<Done<{ keys: string[] }>>;
  deletePrefix(prefix: string): Promise<Done<{ deleted: number }>>;
};

/** The image rows behind some ids, and how many rows there are in all (infrastructure/postgres ImageStore.named). */
export type ImageRowsLookup = {
  named(ids: readonly string[]): Promise<{ live: number; images: readonly { did: Did; id: string }[] }>;
};

/** Book P2.18 key convention: `drafts/<did>/i/<uuid>/<version file>`, the UUID as Postgres writes it. */
const KEY = /^drafts\/([^/]+)\/i\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/;

type Folder = { readonly did: Did; readonly id: string };

/** Each image folder the keys hold, once; a key of any other shape is no image's and is left alone. */
function foldersOf(keys: readonly string[]): Folder[] {
  const folders = new Map<string, Folder>();
  for (const key of keys) {
    const match = KEY.exec(key);
    const did = parseDid(match?.[1] ?? "");
    const id = match?.[2];
    if (did !== null && id !== undefined) folders.set(`${did}/${id}`, { did, id });
  }
  return [...folders.values()];
}

/** Lists, reads the rows, then deletes every orphan folder, all or nothing under the governor; failures are thrown. */
export async function sweepOrphanImages(objects: DraftObjects, rows: ImageRowsLookup): Promise<void> {
  const listed = await objects.list("drafts/");
  if (!listed.ok) throw new Error("orphan sweep could not list the drafts");
  const folders = foldersOf(listed.keys);
  if (folders.length === 0) return;
  const { live, images } = await rows.named(folders.map((folder) => folder.id));
  const named = new Set(images.map((image) => `${image.did}/${image.id}`));
  const orphans = folders.filter((folder) => !named.has(`${folder.did}/${folder.id}`));
  if (!sweepAllowed(orphans.length, live)) throw new RangeError("orphan sweep over its governor");
  let failed = 0;
  for (const orphan of orphans) {
    const done = await objects.deletePrefix(`drafts/${orphan.did}/i/${orphan.id}/`);
    if (!done.ok) failed += 1;
  }
  if (failed > 0) throw new Error("orphan sweep could not delete some objects");
}
