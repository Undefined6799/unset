// Settings › Profile's browser submit handler (P1.20s). The form this page renders posts to /profile
// (routes/profile/+page.server.ts, the one profile save), which answers 303 back to /settings/profile after a save and
// throws a catalog code, with the field it blames, after a refusal. This handler keeps the member on the page and
// tells the form which happened; with no script the plain post and the 303 do the same job. Typed with kit's own
// SubmitFunction and ActionResult: module `$app/forms` in @sveltejs/kit 3.2.0 types/index.d.ts, and
// https://svelte.dev/docs/kit/form-actions (use:enhance).
import type { ProfileFormStatus } from "@unset/apps-web/lib/settings/profile-form.ts";
import type { ActionResult, SubmitFunction } from "$app/forms";

/** Where a save that went through comes back to (the form's `next`). */
const SETTINGS_PROFILE = "/settings/profile";

/** The handler `enhance` runs on each submit; `show` is how the page passes the form its new status. */
export function profileSubmit(show: (status: ProfileFormStatus) => void): SubmitFunction {
  return () => {
    show({ kind: "saving" });
    return async ({ result, update }) => {
      const refused = refusal(result);
      if (refused !== undefined) {
        // What the member typed stays in the fields; the form says what to fix.
        show(refused);
        return;
      }
      show({ kind: "editing" });
      await update({ reset: false });
      if (result.type === "redirect" && result.location === SETTINGS_PROFILE) show({ kind: "saved" });
    };
  };
}

/** A refused save as the form shows it: the save's code and blamed field (App.Error), or none for a bare failure. */
function refusal(result: ActionResult): ProfileFormStatus | undefined {
  if (result.type === "error") return { kind: "refused", code: result.error.message, field: result.error.field };
  if (result.type === "failure") return { kind: "refused", code: undefined, field: undefined };
  return undefined;
}
