import { expect, test } from "vitest";
import { byName, islandName } from "./registry.ts";

test("island_name_is_the_file_stem", () => {
  expect(islandName("./src/islands/header-menu.island.tsx")).toBe("header-menu");
  expect(islandName("../../shared/ui/islands/copy.island.tsx")).toBe("copy");
  for (const path of ["./a/Menu.island.tsx", "./a/menu.tsx", "./a/1menu.island.tsx", "./a/me nu.island.tsx"]) {
    expect(() => islandName(path), path).toThrow();
  }
});

test("island_names_are_unique", () => {
  expect([...byName({ "./a/x.island.tsx": 1, "./b/y.island.tsx": 2 }).keys()]).toEqual(["x", "y"]);
  expect(() => byName({ "./src/islands/x.island.tsx": 1, "../../shared/ui/islands/x.island.tsx": 2 })).toThrow(
    /two islands are named x/,
  );
});
