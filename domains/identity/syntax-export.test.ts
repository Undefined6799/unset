// P0.09p: the package exports syntax.ts on its own subpath, so a trusted file can import parseDid without loading the
// package root, whose index.ts re-exports untrusted modules (book edit 2026-10-12-p009n-trusted-test-imports,
// amendment 5). Node v26.10.0 doc/api/packages.md, "Subpath exports" and "Self-referencing a package using its name".

import { type Did, parseDid } from "@unset/domains-identity/syntax";
import { expect, test } from "vitest";
import * as syntax from "./syntax.ts";

test("syntax_subpath_resolves_to_syntax_ts", () => {
  expect(parseDid).toBe(syntax.parseDid);
  const did: Did | null = parseDid("did:web:example.com");
  expect(did).toBe("did:web:example.com");
});
