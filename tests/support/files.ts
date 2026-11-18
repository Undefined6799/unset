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

/**
 * A sh script that makes everything under `dir` world-readable. The store renames its temp files away while find walks
 * and chmod runs (main CI: max_volume_id.tmp, then unset-private_3.vif.tmp.95791613 inside find's own walk), so a
 * failure whose every stderr line is "No such file or directory" passes; any other line, or a failure with no message,
 * exits 1 and prints stderr.
 */
export function makeReadableScript(dir: string): string {
  return [
    `err=$(find '${dir}' -mindepth 1 -exec chmod a+rX {} + 2>&1 >/dev/null)`,
    "rc=$?",
    '[ -n "$err" ] && printf "%s\\n" "$err" >&2',
    '[ "$rc" = 0 ] && exit 0',
    '[ -n "$err" ] || exit 1',
    "! printf '%s\\n' \"$err\" | grep -v 'No such file or directory$'",
  ].join("\n");
}
