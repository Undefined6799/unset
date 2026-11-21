// Book P3.12v: the index keeps a record as large as one PDS write may carry, so whatever a member saves through our
// PDS shows on their public page. The two numbers live on either side of a boundary (a domain may not import the PDS
// adapter), so this test, in the interface that wires both, holds them equal.
import { MAX_RECORD_BYTES } from "@unset/domains-profile";
import { APPLY_WRITES_BODY_BYTES } from "@unset/infrastructure-pds";
import { expect, test } from "vitest";

test("the index keeps a record as large as one PDS write", () => {
  expect(MAX_RECORD_BYTES).toBe(APPLY_WRITES_BODY_BYTES);
});
