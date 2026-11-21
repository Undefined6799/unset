// The media process's composition root (book P2.19): the store's read through net-guard, with the book's 5 s timeout,
// and the door in front of it. Nothing else is built here.
import { createNetGuard, objectStoreFetch } from "@unset/infrastructure-net-guard";
import { createObjectStore } from "@unset/infrastructure-storage";
import type { Config } from "@unset/shared-config";
import type { schema } from "./config.ts";
import { mediaListener } from "./serve.ts";

const STORE_TIMEOUT_MS = 5000;

export function compose(config: Config<(typeof schema)["fields"]>, logged: (route: string, status: number) => void) {
  const guard = createNetGuard({
    internalHosts: config.NETGUARD_INTERNAL_HOSTS,
    allowLoopback: config.NETGUARD_ALLOW_LOOPBACK,
    commit: config.UNSET_COMMIT,
  });
  const store = createObjectStore({
    origin: config.OBJECT_STORE_URL,
    bucket: config.OBJECT_STORE_BUCKET,
    keyId: config.OBJECT_STORE_ACCESS_ID,
    secret: config.OBJECT_STORE_SECRET.reveal(),
    // A version is at most 5,000,000 bytes (ADR 0088); anything longer fails as unavailable.
    fetch: objectStoreFetch(guard, config.OBJECT_STORE_URL, STORE_TIMEOUT_MS),
  });
  return mediaListener({
    keys: config.DRAFT_URL_KEYRING,
    get: (key) => store.get(key),
    nowS: () => Math.floor(Date.now() / 1000),
    logged,
  });
}
