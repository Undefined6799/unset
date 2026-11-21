// The one Save from the owner's page (ADR 0074): every changed card in one post to `?/saveAll`, each under its
// own index as the action reads it (interfaces/web/src/routes/[did=did]/card-form.server.ts splitCardsForm), with
// the version its editor opened. The body is measured as it will be sent, application/x-www-form-urlencoded
// (https://url.spec.whatwg.org/#urlencoded-serializing), against the page's form cap, so a Save the server would
// refuse for its size is not sent at all.
import type { CardContent, CardSurface, CardWidth } from "./types.ts";

/** One changed card: its kind's own form fields by the names its parser reads (a Text card's `text`). */
export type CardEdit = {
  readonly key: string;
  readonly version: string;
  readonly kind: CardContent["kind"];
  readonly width: CardWidth;
  readonly surface: CardSurface;
  readonly fields: Readonly<Record<string, string>>;
};

export type SaveForm = { readonly kind: "ok"; readonly body: URLSearchParams } | { readonly kind: "too_large" };

export function cardSaveForm(edits: readonly CardEdit[], limitBytes: number): SaveForm {
  const body = new URLSearchParams();
  edits.forEach((edit, index) => {
    const field = (name: string, value: string) => body.append(`cards.${index}.${name}`, value);
    field("key", edit.key);
    field("version", edit.version);
    field("kind", edit.kind);
    field("width", edit.width);
    field("surface", edit.surface);
    for (const [name, value] of Object.entries(edit.fields)) field(name, value);
  });
  return new TextEncoder().encode(body.toString()).length > limitBytes ? { kind: "too_large" } : { kind: "ok", body };
}

/** What the page makes of the action's answer (SvelteKit's ActionResult, kit 3.2.0 `deserialize`). */
export type SaveAnswer =
  | { readonly kind: "saved" }
  | {
      readonly kind: "refused";
      readonly code: string;
      readonly message: string;
      readonly card?: string;
      readonly field?: string;
      readonly saved?: readonly string[];
    }
  /** Sent elsewhere with nothing written, such as to sign in again: the page follows it and keeps the drafts. */
  | { readonly kind: "elsewhere"; readonly location: string }
  | { readonly kind: "failed" };

/** `here` is the owner's page, where the action sends a Save that wrote (+page.server.ts write, 303 to `/${did}`). */
export function readSaveAnswer(
  result: { readonly type: string; readonly data?: unknown; readonly location?: string },
  here: string,
): SaveAnswer {
  if (result.type === "success") return { kind: "saved" };
  if (result.type === "redirect") {
    if (typeof result.location !== "string") return { kind: "failed" };
    return result.location === here ? { kind: "saved" } : { kind: "elsewhere", location: result.location };
  }
  if (result.type !== "failure" || typeof result.data !== "object" || result.data === null) return { kind: "failed" };
  const { code, message, card, field, saved } = result.data as Record<string, unknown>;
  if (typeof code !== "string" || typeof message !== "string") return { kind: "failed" };
  return {
    kind: "refused",
    code,
    message,
    ...(typeof card === "string" ? { card } : {}),
    ...(typeof field === "string" ? { field } : {}),
    ...(Array.isArray(saved) ? { saved: saved.filter((key): key is string => typeof key === "string") } : {}),
  };
}
