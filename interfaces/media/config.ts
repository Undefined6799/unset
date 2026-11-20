// The media process's settings (book P2.19): the draft link keys it checks links with, and its own identity in the
// object store, which may only read `drafts/*` (runbook "The object store's identities"). It holds no database role
// and reaches nothing but the store, through net-guard's `object-store` policy.
import { keyringFile } from "@unset/infrastructure-seal";
import { defineEntrypointConfig, netGuardFields, origin, secretFile, str } from "@unset/shared-config";

export const schema = defineEntrypointConfig({
  ...netGuardFields,
  /** The draft link keys, shared with web and with no other key (book P2.19), as a keyring file. */
  DRAFT_URL_KEYRING: keyringFile(),
  OBJECT_STORE_URL: origin({ protocols: ["http:", "https:"] }),
  OBJECT_STORE_BUCKET: str({ pattern: /[a-z0-9][a-z0-9.-]{2,62}/ }),
  OBJECT_STORE_ACCESS_ID: str({ pattern: /[A-Za-z0-9._-]{1,128}/ }),
  OBJECT_STORE_SECRET: secretFile({ minBytes: 32 }),
});
