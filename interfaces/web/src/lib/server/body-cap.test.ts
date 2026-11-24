// body-cap.ts: adapter-node's cap is the largest maxBody in the real route table. The test reads every policy.ts the
// build globs (route-table.ts), so a route whose limit sits above the cap, or a cap above every route, fails here.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { UPLOAD_LIMITS } from "@unset/domains-content";
import { LIMITS } from "@unset/shared-lexicons";
import { expect, test } from "vitest";
import { IMAGE_UPLOAD_LIMIT_BYTES } from "../../routes/images/policy.ts";
import { BODY_CAP } from "./body-cap.ts";
import type { RoutePolicy } from "./policy.ts";

async function routePolicies(): Promise<RoutePolicy[]> {
  const routes = join(import.meta.dirname, "..", "..", "routes");
  const files = readdirSync(routes, { recursive: true, encoding: "utf8" }).filter(
    (file) => file === "policy.ts" || file.endsWith("/policy.ts"),
  );
  const loaded = await Promise.all(
    files.map(async (file) => (await import(pathToFileURL(join(routes, file)).href)) as { policy: RoutePolicy }),
  );
  return loaded.map((mod) => mod.policy);
}

test("the_cap_is_the_largest_route_body", async () => {
  const policies = await routePolicies();
  expect(policies.length).toBeGreaterThan(10);
  const largest = Math.max(...policies.map((policy) => policy.maxBody ?? 0));
  expect(largest).toBeGreaterThan(64 * 1024);
  expect(BODY_CAP).toBe(largest);
});

test("images.normal_use_fits: a 64 MiB picture with the longest alt and caption is under the upload's cap", async () => {
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(UPLOAD_LIMITS.maxBytes)], { type: "image/jpeg" }), "IMG_0001.jpeg");
  // A grapheme can take several UTF-8 bytes: five each bounds what any alt or caption adds.
  form.set("alt", "é".repeat(LIMITS.card.imageAlt * 5));
  form.set("caption", "é".repeat(LIMITS.card.imageCaption * 5));
  const bytes = (await new Response(form).arrayBuffer()).byteLength;
  expect(bytes).toBeGreaterThan(UPLOAD_LIMITS.maxBytes);
  expect(bytes).toBeLessThanOrEqual(IMAGE_UPLOAD_LIMIT_BYTES);
  expect(BODY_CAP).toBe(IMAGE_UPLOAD_LIMIT_BYTES);
  // ADR 0076: a 60,000,000-byte JPEG from a 60 to 100 megapixel camera is inside the file cap.
  expect(UPLOAD_LIMITS.maxBytes).toBeGreaterThanOrEqual(60_000_000);
  expect(IMAGE_UPLOAD_LIMIT_BYTES).toBe(65 * 1024 * 1024);
});
