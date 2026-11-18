import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkReserved } from "../../../interfaces/pds-admin/cli.ts";
import { fakePds } from "./harness.ts";

const read = (file: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../../interfaces/pds-admin", file), "utf8"));

describe("pds-admin package", () => {
  test("zero_dependency: only the allowlisted envelope workspace, and no devDependencies of its own", () => {
    const pkg = read("package.json");
    expect(pkg.dependencies).toEqual({ "@unset/shared-admin-envelope": "*" });
    expect(pkg.devDependencies).toBeUndefined();
    expect(read("../../shared/admin-envelope/package.json").dependencies).toBeUndefined();
  });

  test("reserved.list: the labels the book names, the one-letter test labels and the underscore rule", () => {
    expect(read("reserved-labels.json")).toEqual({
      labels: ["www", "api", "admin", "account", "mail", "mta-sts", "autoconfig", "status", "a", "b", "x"],
      rules: ["any label starting with _"],
    });
  });

  test("check-reserved prints one line per label against the PDS", async () => {
    const pds = await fakePds();
    const lines = await checkReserved(pds.url, "unset.example.com");
    await pds.close();
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe("www.unset.example.com free");
    expect(lines[2]).toBe("admin.unset.example.com taken");
    expect(pds.seen.every((seen) => seen.auth === undefined)).toBe(true);
  });
});
