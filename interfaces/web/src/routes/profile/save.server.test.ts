// The profile save's outcomes (save.server.ts), as interfaces/http/routes/profile.test.ts checks them. The PDS is the
// one unmanaged dependency, so the save is a double (TE-1); the gate's outcomes are in tests/integration/web.
import { describe, expect, test } from "vitest";
import { type ProfileSave, type SaveProfile, saveProfileForm } from "./save.server.ts";

// The domain types, read off the module under test: a test beside a route imports no domain (svelte-screens-no-core).
type Did = Parameters<SaveProfile>[0];
type ProfileEdit = Parameters<SaveProfile>[1];

const DID = `did:plc:${"a".repeat(24)}` as Did;

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of [value].flat()) data.append(name, one);
  return data;
}

function saver(outcome: ProfileSave = { kind: "saved" }) {
  const saved: { did: Did; fields: ProfileEdit }[] = [];
  const save = async (did: Did, fields: ProfileEdit) => {
    saved.push({ did, fields });
    return outcome;
  };
  return { save, saved };
}

const FIELDS = { displayName: " Alice ", headline: "Designer.", location: "", website: "https://alice.example" };

describe("saveProfileForm", () => {
  test("saves the session's own profile and returns to it", async () => {
    const { save, saved } = saver();
    expect(await saveProfileForm(form(FIELDS), DID, save)).toEqual({ location: `/${DID}` });
    expect(saved).toEqual([
      {
        did: DID,
        fields: { displayName: "Alice", headline: "Designer.", location: "", website: "https://alice.example" },
      },
    ]);
  });

  test("Settings › Profile sends only the side column and comes back to Settings", async () => {
    const { save, saved } = saver();
    const result = await saveProfileForm(
      form({ displayName: "Alice", headline: "", next: "/settings/profile" }),
      DID,
      save,
    );
    expect(result).toEqual({ location: "/settings/profile" });
    expect(saved).toEqual([{ did: DID, fields: { displayName: "Alice", headline: "" } }]);
  });

  test("a DID in the form never picks whose profile is written (SE-2)", async () => {
    const { save, saved } = saver();
    const other = `did:plc:${"m".repeat(24)}`;
    const result = await saveProfileForm(form({ displayName: "Mallory", did: other, repo: other }), DID, save);
    expect(result).toEqual({ location: `/${DID}` });
    expect(saved).toEqual([{ did: DID, fields: { displayName: "Mallory" } }]);
  });

  test("any other next returns to the member's own page", async () => {
    const { save } = saver();
    for (const next of ["https://evil.example/", "//evil.example", "/settings/account", "/settings/profile/"]) {
      expect(await saveProfileForm(form({ displayName: "A", next }), DID, save)).toEqual({ location: `/${DID}` });
    }
  });

  test.each([
    ["a repeated field", form({ ...FIELDS, headline: ["one", "again"] }), "profile.invalid"],
    ["an unsafe website", form({ displayName: "A", website: "javascript:alert(1)" }), "profile.url_invalid"],
    ["a name that is too long", form({ displayName: "x".repeat(65) }), "profile.too_long"],
    ["a newline in the name", form({ displayName: "A\nB" }), "profile.invalid"],
  ])("%s is refused and nothing is written", async (_name, body, code) => {
    const { save, saved } = saver();
    expect(await saveProfileForm(body, DID, save)).toEqual({ code });
    expect(saved).toEqual([]);
  });

  test("a file where a field belongs is refused and nothing is written", async () => {
    const { save, saved } = saver();
    const body = new FormData();
    body.append("displayName", new Blob(["Alice"]), "name.txt");
    expect(await saveProfileForm(body, DID, save)).toEqual({ code: "profile.invalid" });
    expect(saved).toEqual([]);
  });

  test.each([
    [{ kind: "conflict" } as const, "profile.conflict"],
    [{ kind: "refused", code: "profile.name_required" } as const, "profile.name_required"],
    [{ kind: "unavailable" } as const, "profile.pds_unavailable"],
  ])("a %o save shows %s", async (outcome, code) => {
    expect(await saveProfileForm(form(FIELDS), DID, saver(outcome).save)).toEqual({ code });
  });

  test("a dead grant goes to the sign-in pages", async () => {
    const { save } = saver({ kind: "redirect", location: "/login?error=login.session_ended" });
    expect(await saveProfileForm(form(FIELDS), DID, save)).toEqual({ location: "/login?error=login.session_ended" });
  });
});
