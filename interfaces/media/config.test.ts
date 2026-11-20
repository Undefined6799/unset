// The media process boots only with its draft link keys and its read-only store identity (book P2.19).
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { schema } from "./config.ts";

const dir = mkdtempSync(join(tmpdir(), "media-config-"));
const file = (name: string, contents: string) => {
  const path = join(dir, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o600);
  return path;
};
const env = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "media",
  UNSET_COMMIT: "a".repeat(40),
  LISTEN_PORT: "8083",
  DRAFT_URL_KEYRING_FILE: file(
    "keys",
    JSON.stringify({ active: "d1", keys: { d1: Buffer.alloc(32, 9).toString("base64") } }),
  ),
  OBJECT_STORE_URL: "http://objects:8333",
  OBJECT_STORE_BUCKET: "unset-drafts",
  OBJECT_STORE_ACCESS_ID: "media",
  OBJECT_STORE_SECRET_FILE: file("store", "s".repeat(40)),
};

describe("media config", () => {
  test("media_config.boots: with the draft link keys and the store identity", () => {
    const config = loadConfig(schema, env);
    expect(config.DRAFT_URL_KEYRING.active).toBe("d1");
    expect(config.OBJECT_STORE_ACCESS_ID).toBe("media");
  });

  test("media_config.requires_keys: no keyring, or a malformed one, refuses boot", () => {
    const { DRAFT_URL_KEYRING_FILE: _, ...without } = env;
    expect(() => loadConfig(schema, without)).toThrow();
    expect(() => loadConfig(schema, { ...env, DRAFT_URL_KEYRING_FILE: file("bad", "{}") })).toThrow();
  });

  test("media_config.no_print: the keyring prints as a placeholder", () => {
    expect(JSON.stringify(loadConfig(schema, env).DRAFT_URL_KEYRING)).toBe('"[keyring]"');
  });
});
