// The harness's servers build an OAuth client at their origins (fixtures/servers.ts). @atproto/oauth-client 0.8.9
// exports only "." (package.json), and the parse that refuses an IP or a loopback name is clientMetadataSchema in
// dist/types.js, so this imports that file by path.
import { clientMetadata, SCOPE_METADATA } from "@unset/infrastructure-pds";
import { expect, test } from "vitest";
import { clientMetadataSchema } from "../../node_modules/@atproto/oauth-client/dist/types.js";
import { PROD_ORIGIN, TEST_ORIGIN } from "./pages.ts";

test("harness_origins_are_discoverable_client_ids", () => {
  for (const origin of [PROD_ORIGIN, TEST_ORIGIN]) {
    expect(clientMetadataSchema.safeParse(clientMetadata(origin, SCOPE_METADATA)).success, origin).toBe(true);
  }
  for (const refused of ["http://127.0.0.1:8080", "https://localhost:8443"]) {
    expect(clientMetadataSchema.safeParse(clientMetadata(refused, SCOPE_METADATA)).success, refused).toBe(false);
  }
});
