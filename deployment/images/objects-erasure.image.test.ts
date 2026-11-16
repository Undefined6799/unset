// Erasure in the object store itself, not only its flags (P2.18s, ADR 0041 Decision 7, ADR 0050 Decision 3). A put
// leaves no plaintext in any file under /data (-filer.encryptVolumeData). Since that already holds before any delete,
// erasure is checked on the ciphertext: the object's stored chunk bytes are in its volume file after the put, still
// there after the delete alone (a delete is a tombstone), and in no file once the forced vacuum has run. It builds an
// image, so it lives in an *.image.test.ts file (P1.28r).
//
// Every step goes through the store's own loopback services from inside the container, with no S3 identity (ADR 0050):
// the filer's HTTP API takes the upload (a multipart POST, weed/server/filer_server_handlers_write_upload.go at 4.53),
// `weed shell` reads the entry (`fs.meta.cat`), deletes it (`fs.rm`) and vacuums (`lock`, `volume.vacuum
// -garbageThreshold 0`, `unlock`), and the volume server returns a chunk's stored bytes by its file id. Checked on
// 4.53 (2026-11-16).
import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";

const IMAGES = import.meta.dirname;
const BUILD_CALL_MS = killBefore(300_000);
const CALL_MS = 60_000;
const TEST_MS = 300_000 + 12 * CALL_MS;
const SECRET = "/run/secrets/objects_s3";
const KEY = "/buckets/unset-private/drafts/did-plc-erasure-test/draft.txt";
const MARKER = "UNSET-PLAINTEXT-MARKER-7f3c";

/** A container of the built image whose /data is a host folder this test can read. */
function startStore(image: string): { container: string; data: string } {
  const ids = mkdtempSync(join(tmpdir(), "objects-ids-"));
  writeFileSync(join(ids, "objects_s3"), '{"identities":[]}');
  chmodSync(join(ids, "objects_s3"), 0o644);
  const data = mkdtempSync(join(tmpdir(), "objects-data-"));
  chmodSync(data, 0o777);
  const started = docker(
    [
      ...["run", "-d", "--read-only", "--network", "none", "--tmpfs", "/tmp"],
      ...["-v", `${data}:/data`, "-v", `${join(ids, "objects_s3")}:${SECRET}:ro`, image],
    ],
    { timeoutMs: CALL_MS },
  );
  expect(started.code, started.err).toBe(0);
  return { container: started.out.trim(), data };
}

/** Runs `script` with busybox sh in the container. */
function inStore(container: string, script: string, input = "") {
  return docker(["exec", "-i", container, "sh", "-c", script], { timeoutMs: CALL_MS, input });
}

/** `weed shell` with `lines` on stdin. */
function shell(container: string, ...lines: string[]) {
  return docker(["exec", "-i", container, "weed", "shell"], { timeoutMs: CALL_MS, input: `${lines.join("\n")}\n` });
}

/** Retries `probe` once a second until it holds or 30 tries pass. */
function waitFor(container: string, probe: () => boolean): boolean {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (probe()) return true;
    docker(["exec", container, "sleep", "1"], { timeoutMs: CALL_MS });
  }
  return false;
}

/**
 * Every regular file under the store's /data, at `dir` on the host, that holds `needle`. The store writes its files as
 * its own uid (1000), some of them 0600, and CI's runner is another uid, so the store first makes them readable.
 */
function filesHolding({ container, data: dir }: { container: string; data: string }, needle: Buffer): string[] {
  const readable = inStore(container, "find /data -mindepth 1 -exec chmod a+rX {} +");
  expect(readable.code, readable.err).toBe(0);
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile() && readFileSync(path).includes(needle));
}

/** Puts a text draft holding the marker, and returns the stored (encrypted) bytes of its one chunk. */
function putDraft(container: string): Buffer {
  const draft = `${"x".repeat(2000)}\n${MARKER}\n`;
  const put = inStore(
    container,
    [
      "set -e",
      `{ printf -- '--B0\\r\\nContent-Disposition: form-data; name="file"; filename="draft.txt"\\r\\n\\r\\n'; cat; printf -- '\\r\\n--B0--\\r\\n'; } > /tmp/body`,
      `wget -q -O - --header 'Content-Type: multipart/form-data; boundary=B0' --post-file=/tmp/body http://127.0.0.1:8888${KEY}`,
    ].join("\n"),
    draft,
  );
  expect(put.code, put.err).toBe(0);
  const meta = shell(container, `fs.meta.cat ${KEY}`).out;
  const fileIds = [...meta.matchAll(/"fileId":\s*"([0-9]+,[0-9a-f]+)"/g)].map((match) => match[1]);
  expect(fileIds, meta).toHaveLength(1);
  expect(meta).toMatch(/"cipherKey":\s*"[A-Za-z0-9+/=]{16,}"/);
  const chunk = inStore(container, `wget -q -O /tmp/chunk http://127.0.0.1:8080/${fileIds[0]} && base64 /tmp/chunk`);
  expect(chunk.code, chunk.err).toBe(0);
  const stored = Buffer.from(chunk.out.replace(/\s/g, ""), "base64");
  expect(stored.length).toBeGreaterThan(64);
  return stored;
}

/** The deleted-file count the master reports for the bucket's volumes, summed. */
function deletedCount(container: string): number {
  const listed = shell(container, "volume.list").out;
  return [...listed.matchAll(/Collection:unset-private,.*?DeleteCount:(\d+)/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );
}

/** A store with the bucket, ready for a put; `body` gets it, and the container and its files go afterwards. */
function withStore(body: (store: { container: string; data: string }) => void): void {
  const image = buildTestImage(join(IMAGES, "objects.Dockerfile"), IMAGES, { timeoutMs: BUILD_CALL_MS });
  withCleanup(
    () => {
      const store = startStore(image);
      withCleanup(
        () => {
          const healthy = () =>
            inStore(store.container, "wget -q -O /dev/null http://127.0.0.1:8333/healthz").code === 0;
          expect(waitFor(store.container, healthy)).toBe(true);
          const created = shell(store.container, "s3.bucket.create -name unset-private");
          expect(created.out, created.err).toContain("created bucket unset-private");
          body(store);
        },
        () => {
          // Files the store wrote belong to its user, so the store removes them before it goes.
          inStore(store.container, "rm -rf /data/* /data/.[!.]*");
          docker(["rm", "-f", store.container], { timeoutMs: CALL_MS });
        },
      );
    },
    () => removeTestImage(image, { timeoutMs: CALL_MS }),
  );
}

describe("objects erasure (P2.18s)", () => {
  test(
    "objects_no_plaintext_at_rest",
    () => {
      withStore((store) => {
        const { container } = store;
        const stored = putDraft(container);
        expect(filesHolding(store, stored)).not.toEqual([]);
        expect(filesHolding(store, Buffer.from(MARKER))).toEqual([]);
      });
    },
    TEST_MS,
  );

  test(
    "objects_erase_removes_bytes",
    () => {
      withStore((store) => {
        const { container } = store;
        const stored = putDraft(container);
        expect(filesHolding(store, stored)).not.toEqual([]);
        // The delete alone is a tombstone: the bytes stay until the vacuum, so skipping it fails this test.
        const removed = shell(container, `fs.rm ${KEY}`);
        expect(removed.code, removed.err).toBe(0);
        expect(waitFor(container, () => deletedCount(container) >= 1)).toBe(true);
        expect(filesHolding(store, stored)).not.toEqual([]);
        const vacuumed = shell(container, "lock", "volume.vacuum -garbageThreshold 0", "unlock");
        expect(vacuumed.code, vacuumed.err).toBe(0);
        expect(filesHolding(store, stored)).toEqual([]);
        expect(filesHolding(store, stored.subarray(0, 64))).toEqual([]);
      });
    },
    TEST_MS,
  );
});
