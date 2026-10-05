// Request body limits (P1.06): a declared length over the limit is refused before anything is read, and a body
// without one is counted as it streams, so no handler ever holds more than the limit.

/** The handler-side marker: the counted body went over the limit, and the kit answers 413 whatever the handler did. */
export class BodyTooLarge extends Error {}

export type LimitedBody = { ok: true; request: Request; exceeded: () => boolean } | { ok: false; status: 400 | 413 };

const DIGITS = /^[0-9]{1,15}$/;

/** A copy of `request` whose body errors with `BodyTooLarge` once more than `maxBytes` have been read. */
function counted(request: Request, maxBytes: number): { request: Request; exceeded: () => boolean } {
  let read = 0;
  let over = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      read += chunk.byteLength;
      if (read > maxBytes) {
        over = true;
        controller.error(new BodyTooLarge());
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const body = request.body?.pipeThrough(counter) ?? null;
  // `duplex: "half"` is what undici requires for a stream body (Node 26.10, fetch's RequestInit).
  return { request: new Request(request, { body, duplex: "half" } as RequestInit), exceeded: () => over };
}

/**
 * Steps 1–3: both `Content-Length` and `Transfer-Encoding`, or a length that is not a plain integer, is 400 (the
 * request-smuggling shape); a length over `maxBytes` is 413 before reading; anything else is read through a counter.
 */
export function limitBody(request: Request, maxBytes: number): LimitedBody {
  const length = request.headers.get("content-length");
  if (length !== null && request.headers.has("transfer-encoding")) return { ok: false, status: 400 };
  if (length !== null && !DIGITS.test(length)) return { ok: false, status: 400 };
  if (length !== null && Number(length) > maxBytes) return { ok: false, status: 413 };
  if (request.body === null) return { ok: true, request, exceeded: () => false };
  return { ok: true, ...counted(request, maxBytes) };
}
