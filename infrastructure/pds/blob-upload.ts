// A picture's main version to the member's own PDS (ADR 0070 point 5, the publish step): one
// com.atproto.repo.uploadBlob call (@atproto/api 0.30.3 dist/client/types/com/atproto/repo/uploadBlob.d.ts), whose
// body net-guard lets reach 5 MiB (atprotoBlobUpload, ADR 0088). The answer is the blob ref a record embeds, in its JSON form
// (atproto.com/specs/data-model, "Blob Type": `$type: "blob"`, `ref` as `{ $link }`, `mimeType`, `size`).
import type { Did } from "@unset/domains-identity";
import { PDS_UPLOAD_TIMEOUT_MS, type PdsContext, type PdsResult } from "./pds-call.ts";
import type { PdsCall } from "./repo-record.ts";

export type UploadedBlob = {
  readonly $type: "blob";
  readonly ref: { readonly $link: string };
  readonly mimeType: string;
  readonly size: number;
};

/** The main version's format (domains/content standard.ts, ADR 0088): every published picture is a WebP. */
const MIME = "image/webp";

/**
 * Sends the WebP; idempotent, since the PDS names a blob by its bytes' CID, so a retry stores the same blob once. An
 * answer that is not this blob (another type or size, no CID) is thrown, so pdsCall answers it as unavailable and no
 * record ever embeds it. Until a record uses it the PDS holds it as a temporary blob. A PDS that refuses the size answers
 * `rejected` with status 413, and nothing smaller is sent in its place (ADR 0088).
 */
export function uploadImageBlob(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  bytes: Uint8Array,
): Promise<PdsResult<UploadedBlob>> {
  return pdsCall(
    ctx,
    did,
    async (agent): Promise<UploadedBlob> => {
      const { data } = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: MIME });
      const blob = JSON.parse(JSON.stringify(data.blob)) as Partial<UploadedBlob>;
      const link = blob.ref?.$link;
      if (blob.$type !== "blob" || typeof link !== "string" || blob.mimeType !== MIME || blob.size !== bytes.length) {
        throw new Error("uploadBlob answered another blob");
      }
      return { $type: "blob", ref: { $link: link }, mimeType: MIME, size: bytes.length };
    },
    { idempotent: true, timeoutMs: PDS_UPLOAD_TIMEOUT_MS },
  );
}
