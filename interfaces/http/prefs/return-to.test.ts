// Property test for the theme form's return target (P2.13d, verify-1113 N4; TE-6): whatever themeReturnTo returns is
// home, the kit's own answer, or a sign-in page carrying only a safe next and a parsed handle, and returning it again
// changes nothing.
import { parseDid, parseHandle } from "@unset/domains-identity";
import { safeReturnPath } from "@unset/shared-http";
import fc from "fast-check";
import { expect, test } from "vitest";
import { themeReturnTo } from "./return-to.ts";

/** Pieces that steer the sign-in exception, mixed with random text so the property runs on the dangerous space. */
const PIECES = [
  "/login",
  "/login/continue",
  "login",
  "./",
  "../",
  "/LOGIN",
  "/",
  "//",
  "\\",
  ".",
  "..",
  "/./",
  "/../",
  "?",
  "&",
  "#",
  "=",
  "next=",
  "handle=",
  "%2F",
  "%2f%2f",
  "%6c",
  "https://evil.example",
  "alice.example.com",
  "did:plc:abcdefghijklmnopqrstuvwx",
  "<script>",
  "x",
];
const piece = fc.oneof(fc.constantFrom(...PIECES), fc.string({ unit: "grapheme", maxLength: 6 }));
const target = fc.oneof(
  fc.array(piece, { maxLength: 10 }).map((parts) => parts.join("")),
  fc.array(piece, { maxLength: 10 }).map((parts) => `/login${parts.join("")}`),
  fc.string({ unit: "binary", maxLength: 40 }),
  // Dot segments in front of a sign-in path, which the kit resolves away (verify-1113 N1).
  fc
    .tuple(
      fc.constantFrom("/./", "/a/../", "/%2e/", "/./a/../"),
      fc.constantFrom("login", "LOGIN", "login/continue"),
      fc.array(piece, { maxLength: 4 }),
    )
    .map(([dots, path, rest]) => `${dots}${path}${rest.join("")}`),
);

/** True for a sign-in page whose query holds at most one safe next and one parsed handle, and nothing else. */
function isCheckedSignIn(out: string): boolean {
  const mark = out.indexOf("?");
  const path = mark === -1 ? out : out.slice(0, mark);
  if (path !== "/login" && path !== "/login/continue") return false;
  const query = new URLSearchParams(mark === -1 ? "" : out.slice(mark + 1));
  for (const name of new Set(query.keys())) {
    const values = query.getAll(name);
    if (values.length !== 1) return false;
    const value = values[0] ?? "";
    if (name === "next" && safeReturnPath(value) !== value) return false;
    if (name === "handle" && (parseDid(value) ?? parseHandle(value)) !== value) return false;
    if (name !== "next" && name !== "handle") return false;
  }
  return true;
}

test("theme_return_is_home_kit_answer_or_checked_sign_in", () => {
  fc.assert(
    fc.property(target, (raw) => {
      const out = themeReturnTo(raw);
      const kit = safeReturnPath(raw);
      const kitAnswer = kit !== null && !kit.toLowerCase().startsWith("/login") && out === kit;
      expect(out === "/" || kitAnswer || isCheckedSignIn(out), `${JSON.stringify(raw)} -> ${out}`).toBe(true);
      expect(themeReturnTo(out)).toBe(out);
    }),
    { numRuns: 2000 },
  );
});
