// The root vitest.config.ts CSS Modules settings (P1.23v): a test sees real scoped class names from the one
// scripts/ui/css-scope.ts function, the same names the client and SSR builds emit, never Vitest's own proxy.
/// <reference types="vite/client" />
import { join } from "node:path";
import { expect, test } from "vitest";
import { scopedName } from "../ui/css-scope.ts";
import styles from "./fixtures/css-modules/scope.module.css";

test("vitest_css_modules_use_scoped_name", () => {
  const file = join(import.meta.dirname, "fixtures", "css-modules", "scope.module.css");
  expect(styles.root).toBe(scopedName("root", file));
  expect(styles.root).toMatch(/^root_[0-9a-f]{8}$/);
});
