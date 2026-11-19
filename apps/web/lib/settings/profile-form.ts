/**
 * Where Settings › Profile's form stands, as its page's submit handler sets it (interfaces/web
 * routes/settings/profile/submit.ts, P1.20s): being edited, being saved, saved, or refused with the catalog code and
 * the field the save blames, when it names one. With no script the form stays `editing`; the save answers by reload.
 */
export type ProfileFormStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "refused"; readonly code: string | undefined; readonly field: string | undefined };
