import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { REPO_ROOT, scopedName } from "./css-scope.ts";

describe("scoped_name_deterministic", () => {
  const file = join(REPO_ROOT, "shared/ui/components/Button/Button.module.css");

  test("a fixed vector: sha256 of the repo-relative POSIX path, a colon and the class name", () => {
    // sha256("shared/ui/components/Button/Button.module.css:root") begins 9e846a57 (printf ... | sha256sum, GNU coreutils).
    expect(scopedName("root", file)).toBe(`root_${VECTOR}`);
  });

  test("the same input always gives the same name, and a query string is ignored", () => {
    expect(scopedName("root", file)).toBe(scopedName("root", file));
    expect(scopedName("root", `${file}?used`)).toBe(scopedName("root", file));
  });

  test("the class name and the path both change the hash", () => {
    expect(scopedName("label", file)).not.toBe(scopedName("root", file).replace("root", "label"));
    expect(scopedName("root", join(REPO_ROOT, "apps/web/src/x.module.css"))).not.toBe(scopedName("root", file));
  });

  test("a file outside the repository is refused, so no absolute path is ever hashed", () => {
    expect(() => scopedName("root", "/elsewhere/x.module.css")).toThrow(/outside the repository/);
    expect(() => scopedName("root", "shared/ui/x.module.css")).toThrow(/absolute/);
  });
});

const VECTOR = "9e846a57";
