// POST /images (ADR 0070 point 2.1, book P2.19b): a member's picture, as the multipart field `image`, from the editor's
// script, which shows progress; the no-script card form calls the same intake (upload.server.ts) from its own action.
// The gate has checked the session, the CSRF gate, the method, the form type and the declared length (policy.ts).
// The answer is JSON: the image's id and size, or a refusal code the editor turns into a message.
import type { RequestHandler } from "@sveltejs/kit";
import type { Did } from "@unset/domains-identity";
import { type Services, services } from "../../lib/server/compose.ts";
import { IMAGE_UPLOADS_IN_FLIGHT, REVIEW_LANES } from "../../lib/server/limits.ts";
import { policy } from "./policy.ts";
import {
  createReviewLanes,
  createUploadSlots,
  type DraftObjects,
  type ImageRows,
  type UploadCode,
  uploadImage,
} from "./upload.server.ts";

/** This process's uploads in flight and its turns at review; one module, so one count of each. */
const slots = createUploadSlots(IMAGE_UPLOADS_IN_FLIGHT);
const lanes = createReviewLanes(REVIEW_LANES);
const AFTER_BODY_MS = policy.deadlineMs ?? 0;

const STATUS: Partial<Record<UploadCode, number>> = {
  "image.closed": 403,
  "image.one_at_a_time": 409,
  "image.hourly_limit": 429,
  "image.daily_limit": 429,
  "image.busy": 503,
  "image.timeout": 503,
  "image.missing": 400,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });

/** The one field `image`, a file; null for anything else or a body that ends early. */
async function readImage(request: Request): Promise<Uint8Array | null> {
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || [...form.keys()].some((key) => key !== "image")) return null;
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/** The member's rows, every call naming their DID and the deadline it runs under (rule SE-2, RE-1). */
const rowsOf = (store: Services["images"]["store"], did: Did): ImageRows => ({
  admit: (deadline) => store.admit(did, deadline),
  store: (image, deadline) => store.store(did, image, deadline),
  discard: (id, deadline) => store.discard(did, id, deadline),
});

/** The store under the member's own prefix only; an id is ours (a UUID), never the request's. */
const objectsOf = (drafts: Services["drafts"], did: Did): DraftObjects => ({
  put: (path, bytes, contentType) => drafts.put(`drafts/${did}/i/${path}`, bytes, contentType),
  deletePrefix: (path) => drafts.deletePrefix(`drafts/${did}/i/${path}`),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  if (locals.did === undefined) return json(401, { code: "auth.required" }); // the gate already refused this
  const { images, drafts } = services();
  const deps = {
    open: images.open,
    member: locals.did,
    slots,
    lanes,
    rows: rowsOf(images.store, locals.did),
    processor: images.processor,
    objects: objectsOf(drafts, locals.did),
    deadline: locals.deadline,
    afterBodyMs: AFTER_BODY_MS,
  };
  const result = await uploadImage(deps, () => readImage(request));
  if (!result.ok) return json(STATUS[result.code] ?? 422, { code: result.code });
  return json(201, { id: result.id, width: result.width, height: result.height, versions: result.versions });
};
