// Walking a directory another process is still writing to (the object store's /data, objects-erasure.image.test.ts).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const listAll = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: "utf8" });

/** Whether `error` says the file is gone: it was listed, then renamed or removed before we reached it. */
const vanished = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

/**
 * Every regular file under `dir` that holds `needle`. A file the listing named but that is gone by the time it is read
 * (SeaweedFS writes max_volume_id.tmp and renames it) is skipped; any other error is thrown.
 */
export function regularFilesHolding(dir: string, needle: Buffer, list: (dir: string) => string[] = listAll): string[] {
  const found: string[] = [];
  for (const name of list(dir)) {
    const path = join(dir, name);
    try {
      if (statSync(path).isFile() && readFileSync(path).includes(needle)) found.push(path);
    } catch (error) {
      if (!vanished(error)) throw error;
    }
  }
  return found;
}
