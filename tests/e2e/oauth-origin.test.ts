// The production harness process builds an OAuth client. @atproto/oauth-client 0.8.9
// exports only "." (package.json), and the parse that rejected http://127.0.0.1 is
// clientMetadataSchema in dist/types.js, so this imports that file by path.
import { clientMetadata, SCOPE_METADATA } from "@unset/infrastructure-pds";
import { expect, test } from "vitest";
import { clientMetadataSchema } from "../../node_modules/@atproto/oauth-client/dist/types.js";
import { PROD_ORIGIN, PROD_PUBLIC_ORIGIN } from "./pages.ts";

test("prod_public_origin_is_a_discoverable_client_id", () => {
  const accepted = clientMetadataSchema.safeParse(clientMetadata(PROD_PUBLIC_ORIGIN, SCOPE_METADATA));
  const refused = clientMetadataSchema.safeParse(clientMetadata(PROD_ORIGIN, SCOPE_METADATA));
  expect(accepted.success).toBe(true);
  expect(refused.success).toBe(false);
});
