// The object store (P2.18s, ADR 0041; book P2.18 "Outputs"): S3 calls signed with aws4fetch 1.0.20 and sent
// through the fetch the composition root passes in, which is net-guard's for the `object-store` policy (P2.18k).
// `AwsClient.sign()` builds a signed Request and opens no connection (aws4fetch dist/aws4fetch.esm.mjs:42), so
// nothing here reads the AWS environment, a config file or instance metadata. Path-style URLs, a fixed region.
// Failures are typed results, never throws, and never carry the key: keys hold raw DIDs (SE-7). A malformed key is a
// programming error and throws a TypeError.
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

export type ObjectStoreSettings = {
  /** The store's one internal origin, `OBJECT_STORE_URL`. */
  readonly origin: string;
  readonly bucket: string;
  readonly keyId: string;
  readonly secret: string;
  /** net-guard's fetch for the `object-store` policy, with its timeout and response cap. */
  readonly fetch: typeof fetch;
};

export type Tags = Readonly<Record<string, string>>;
type Unavailable = { readonly ok: false; readonly code: "objects.unavailable" };
type Done<T> = ({ readonly ok: true } & T) | Unavailable;

export type ObjectStore = {
  /** One request: through net-guard a body over its 1 MiB request cap fails as unavailable (larger media: Phase 4). */
  put(key: string, bytes: Uint8Array, contentType: string, tags?: Tags): Promise<Done<object>>;
  setTags(key: string, tags: Tags): Promise<Done<object>>;
  /** `bytes` is null when no object has that key. */
  get(key: string): Promise<Done<{ bytes: Uint8Array | null }>>;
  /** Every key under `prefix`, in order. */
  list(prefix: string): Promise<Done<{ keys: string[] }>>;
  /** Deletes every object under `prefix`; `deleted` counts them. */
  deletePrefix(prefix: string): Promise<Done<{ deleted: number }>>;
};

const UNAVAILABLE: Unavailable = { ok: false, code: "objects.unavailable" };
const REGION = "us-east-1";
/** S3's ceiling for one list page and one multi-object delete. */
const BATCH = 1000;
/** Our key alphabet (book P2.18 key convention: `drafts/<did>/i/<uuid>/<variant>`): no encoding is ever needed. */
const KEY = /^[A-Za-z0-9._:-]+(\/[A-Za-z0-9._:-]+)*\/?$/;

function checkKey(key: string): void {
  if (!KEY.test(key) || key.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("object key outside the allowed alphabet");
  }
}

const sha256 = (body: Uint8Array | string): string => createHash("sha256").update(body).digest("hex");
const xmlText = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const tagQuery = (tags: Tags): string => new URLSearchParams(Object.entries(tags)).toString();
const tagXml = (tags: Tags): string =>
  `<Tagging><TagSet>${Object.entries(tags)
    .map(([k, v]) => `<Tag><Key>${k}</Key><Value>${v}</Value></Tag>`)
    .join("")}</TagSet></Tagging>`;

export function createObjectStore(settings: ObjectStoreSettings): ObjectStore {
  const client = new AwsClient({
    accessKeyId: settings.keyId,
    secretAccessKey: settings.secret,
    service: "s3",
    region: REGION,
  });
  const bucketUrl = `${settings.origin}/${settings.bucket}`;

  /** One signed call; the payload hash is signed too (never UNSIGNED-PAYLOAD). null when the call itself failed. */
  async function call(
    method: "GET" | "PUT" | "POST",
    url: string,
    body?: Uint8Array | string,
    headers: Record<string, string> = {},
  ): Promise<Response | null> {
    try {
      const signed = await client.sign(url, {
        method,
        headers: { ...headers, "x-amz-content-sha256": sha256(body ?? "") },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : new Uint8Array(body) }),
      });
      return await settings.fetch(signed);
    } catch {
      return null;
    }
  }

  async function listPage(
    prefix: string,
    token: string | null,
  ): Promise<{ keys: string[]; next: string | null } | null> {
    const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": String(BATCH) });
    if (token !== null) query.set("continuation-token", token);
    const res = await call("GET", `${bucketUrl}?${query}`);
    if (res?.status !== 200) return null;
    const xml = await res.text();
    // A 200 can still carry a cut-off or invalid document (ListObjectsV2 API reference): a page counts only when it is
    // one whole ListBucketResult that says whether it is truncated, so a cleanup never reads a broken page as empty.
    const whole = /^\s*(<\?xml[^>]*\?>\s*)?<ListBucketResult[\s>][\s\S]*<\/ListBucketResult>\s*$/.test(xml);
    if (!whole || !/<IsTruncated>(true|false)<\/IsTruncated>/.test(xml)) return null;
    const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => xmlText(m[1] ?? ""));
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
    if (truncated && next === undefined) return null;
    return { keys, next: truncated && next !== undefined ? xmlText(next) : null };
  }

  async function list(prefix: string): Promise<Done<{ keys: string[] }>> {
    checkKey(prefix);
    const keys: string[] = [];
    let token: string | null = null;
    do {
      const page = await listPage(prefix, token);
      if (page === null) return UNAVAILABLE;
      keys.push(...page.keys);
      token = page.next;
    } while (token !== null);
    return { ok: true, keys };
  }

  /** One multi-object delete (POST ?delete, Content-MD5 required); false unless every key was deleted. */
  async function deleteBatch(keys: readonly string[]): Promise<boolean> {
    const objects = keys.map((key) => `<Object><Key>${key}</Key></Object>`).join("");
    const xml = `<Delete><Quiet>true</Quiet>${objects}</Delete>`;
    const md5 = createHash("md5").update(xml).digest("base64");
    const res = await call("POST", `${bucketUrl}?delete`, xml, {
      "content-md5": md5,
      "content-type": "application/xml",
    });
    if (res?.status !== 200) return false;
    return !(await res.text()).includes("<Error>");
  }

  return {
    async put(key, bytes, contentType, tags) {
      checkKey(key);
      const headers: Record<string, string> = { "content-type": contentType };
      if (tags !== undefined && Object.keys(tags).length > 0) headers["x-amz-tagging"] = tagQuery(tags);
      const res = await call("PUT", `${bucketUrl}/${key}`, bytes, headers);
      return res?.status === 200 ? { ok: true } : UNAVAILABLE;
    },

    async setTags(key, tags) {
      checkKey(key);
      const res = await call("PUT", `${bucketUrl}/${key}?tagging`, tagXml(tags), { "content-type": "application/xml" });
      return res?.status === 200 ? { ok: true } : UNAVAILABLE;
    },

    async get(key) {
      checkKey(key);
      const res = await call("GET", `${bucketUrl}/${key}`);
      if (res?.status === 404) return { ok: true, bytes: null };
      if (res?.status !== 200) return UNAVAILABLE;
      try {
        return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch {
        return UNAVAILABLE;
      }
    },

    list,

    async deletePrefix(prefix) {
      const listed = await list(prefix);
      if (!listed.ok) return listed;
      for (let start = 0; start < listed.keys.length; start += BATCH) {
        if (!(await deleteBatch(listed.keys.slice(start, start + BATCH)))) return UNAVAILABLE;
      }
      return { ok: true, deleted: listed.keys.length };
    },
  };
}
