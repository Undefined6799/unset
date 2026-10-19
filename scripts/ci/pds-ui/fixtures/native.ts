// Test-only native tar/OCI/artifact builders. No extraction or container execution.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
export const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export type Item = {
  name: string;
  body?: string | Buffer;
  type?: "file" | "directory" | "symlink" | "link" | "fifo";
  mode?: number;
  uid?: number;
  linkname?: string;
  pax?: Record<string, string>;
};
export async function tar(items: Item[]): Promise<Buffer> {
  const stream = pack();
  for (const item of items) stream.entry({ mode: 0o644, ...item }, item.body ?? "");
  stream.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error("invalid fixture chunk");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function image(
  layers: Buffer[],
  runtime = { Env: ["NODE_ENV=production"], Cmd: ["node", "index.ts"] },
  indexed = false,
  gzipLayers: number[] = [],
) {
  const storedLayers = layers.map((layer, i) => (gzipLayers.includes(i) ? gzipSync(layer) : layer));
  const configuration = Buffer.from(
    JSON.stringify({
      os: "linux",
      architecture: "arm64",
      config: runtime,
      rootfs: { type: "layers", diff_ids: layers.map((l) => `sha256:${sha(l)}`) },
    }),
  );
  const descriptor = (data: Buffer, mediaType: string) => ({
    mediaType,
    digest: `sha256:${sha(data)}`,
    size: data.length,
  });
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: descriptor(configuration, "application/vnd.oci.image.config.v1+json"),
      layers: storedLayers.map((layer, i) =>
        descriptor(
          layer,
          gzipLayers.includes(i)
            ? "application/vnd.oci.image.layer.v1.tar+gzip"
            : "application/vnd.oci.image.layer.v1.tar",
        ),
      ),
    }),
  );
  const nested = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      manifests: [
        {
          ...descriptor(manifest, "application/vnd.oci.image.manifest.v1+json"),
          platform: { os: "linux", architecture: "arm64" },
        },
      ],
    }),
  );
  const index = JSON.stringify({
    schemaVersion: 2,
    manifests: [
      descriptor(
        indexed ? nested : manifest,
        indexed ? "application/vnd.oci.image.index.v1+json" : "application/vnd.oci.image.manifest.v1+json",
      ),
    ],
  });
  const blobs = [configuration, manifest, ...(indexed ? [nested] : []), ...storedLayers];
  return {
    digest: `sha256:${sha(indexed ? nested : manifest)}`,
    bytes: await tar([
      { name: "index.json", body: index },
      ...[...new Map(blobs.map((b) => [sha(b), b])).entries()].map(([digest, body]) => ({
        name: `blobs/sha256/${digest}`,
        body,
      })),
    ]),
  };
}
export function artifacts() {
  const entries = ["account-page", "authorization-page", "error-page", "cookie-error-page"];
  const files = new Map(entries.map((name) => [`${name}.js`, Buffer.from(`// ${name}`)]));
  files.set("shared.css", Buffer.from("body{}"));
  const manifest = Object.fromEntries(
    [...files].map(([name, body]) => [
      name,
      name.endsWith(".js")
        ? {
            type: "chunk",
            mime: "application/javascript",
            sha256: createHash("sha256").update(body).digest("base64"),
            dynamicImports: [],
            isDynamicEntry: false,
            isEntry: true,
            name: name.slice(0, -3),
          }
        : { type: "asset", mime: "text/css", sha256: createHash("sha256").update(body).digest("base64") },
    ]),
  );
  files.set("bundle-manifest.json", Buffer.from(JSON.stringify(manifest)));
  return files;
}
