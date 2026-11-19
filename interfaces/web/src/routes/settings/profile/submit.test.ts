// Settings › Profile's browser submit (P1.20s): what the form shows after /profile answers, with kit's own
// ActionResult shapes (`$app/forms`, @sveltejs/kit 3.2.0 types/index.d.ts).
import type { ProfileFormStatus } from "@unset/apps-web/lib/settings/profile-form.ts";
import { describe, expect, test } from "vitest";
import type { ActionResult, SubmitFunction } from "$app/forms";
import { profileSubmit } from "./submit.ts";

/** One submit through the handler: every status it set, in order, and the options each `update` call got. */
async function submit(result: ActionResult) {
  const statuses: ProfileFormStatus[] = [];
  const updates: unknown[] = [];
  const form = detachedForm();
  const after = await profileSubmit((status) => statuses.push(status))({
    action: new URL("https://unset.test/profile"),
    formData: new FormData(),
    formElement: form,
    controller: new AbortController(),
    submitter: null,
    cancel: () => {
      throw new Error("the profile form never cancels");
    },
  });
  if (typeof after !== "function") throw new Error("the handler must answer the result");
  await after({
    action: new URL("https://unset.test/profile"),
    formData: new FormData(),
    formElement: form,
    result,
    update: async (options) => {
      updates.push(options);
    },
  });
  return { statuses, updates };
}

/** The handler never reads the form element; the tests run without a DOM. */
const detachedForm = () => ({}) as Parameters<SubmitFunction>[0]["formElement"];

describe("profileSubmit", () => {
  test("a save that comes back to settings says it saved, keeping what was typed", async () => {
    const { statuses, updates } = await submit({ type: "redirect", status: 303, location: "/settings/profile" });
    expect(statuses).toEqual([{ kind: "saving" }, { kind: "editing" }, { kind: "saved" }]);
    expect(updates).toEqual([{ reset: false }]);
  });

  test("a refusal blames the field the save names, and the page is not reloaded", async () => {
    const { statuses, updates } = await submit({
      type: "error",
      status: 400,
      error: { status: 400, message: "profile.too_long", field: "headline" },
    });
    expect(statuses).toEqual([{ kind: "saving" }, { kind: "refused", code: "profile.too_long", field: "headline" }]);
    expect(updates).toEqual([]);
  });

  test("a PDS failure is a refusal with no field", async () => {
    const { statuses } = await submit({
      type: "error",
      status: 503,
      error: { status: 503, message: "profile.pds_unavailable" },
    });
    expect(statuses.at(-1)).toEqual({ kind: "refused", code: "profile.pds_unavailable", field: undefined });
  });

  test("a failure without a code is a refusal the form words itself", async () => {
    const { statuses, updates } = await submit({ type: "failure", status: 400, location: "/profile" });
    expect(statuses.at(-1)).toEqual({ kind: "refused", code: undefined, field: undefined });
    expect(updates).toEqual([]);
  });

  test("a redirect elsewhere (sign in again) is followed and says nothing saved", async () => {
    const { statuses, updates } = await submit({ type: "redirect", status: 303, location: "/login" });
    expect(statuses).toEqual([{ kind: "saving" }, { kind: "editing" }]);
    expect(updates).toEqual([{ reset: false }]);
  });
});
