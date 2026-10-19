// P1.36h: the image's CLI lints its migrations without looking up `-- query:` files, which the image does not hold, and
// the repository's own migrations still pass the full lint, file lookup included, on every run of this test.
import { join } from "node:path";
import { expect, test } from "vitest";
import { readMigrations } from "./migrate.ts";
import { MIGRATIONS } from "./migrate-cli.ts";

test("cli_lints_without_the_query_file_lookup", () => {
  expect(MIGRATIONS.checkQueryFiles).toBe(false);
  expect(MIGRATIONS.dir).toBe(join(import.meta.dirname, "migrations"));
});

test("repository_migrations_pass_the_full_lint", () => {
  const read = readMigrations(MIGRATIONS.dir, { root: join(import.meta.dirname, "..", ".."), checkQueryFiles: true });
  expect(Array.isArray(read), JSON.stringify(read)).toBe(true);
});
