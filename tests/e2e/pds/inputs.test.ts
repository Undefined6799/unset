import { expect, test } from "vitest";
import { verifiedPlc } from "../../integration/pds-ui/inputs.ts";

test("rejects substituted PLC bytes before extraction or runtime start", () => {
  expect(() => verifiedPlc(Buffer.from("substituted"))).toThrow("PLC archive integrity");
  expect(() => verifiedPlc(Buffer.alloc(3_741_629))).toThrow("PLC archive integrity");
});

// An arbitrary URL/path or mutation method must fail before any socket is opened.
import { executeRpc } from "../../integration/pds-ui/helper.ts";

test("refuses arbitrary native targets and oversized requests before network access", async () => {
  const request = {
    kind: "native" as const,
    port: 2583,
    path: "https://example.invalid",
    method: "GET",
    headers: {},
    body: "",
  };
  await expect(executeRpc(request)).rejects.toThrow("fixture target refused");
  await expect(executeRpc({ ...request, path: "/account", method: "DELETE" })).rejects.toThrow(
    "invalid fixture request",
  );
  await expect(executeRpc({ ...request, path: "/account", body: "x".repeat(65_537) })).rejects.toThrow(
    "invalid fixture request",
  );
});
