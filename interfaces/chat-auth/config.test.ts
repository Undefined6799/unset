// The door's settings (build step 6; ADR 0081 decision 4): its own https origin on unset.cc and web's, the kit's proxy
// and limit keys, its database, keyring and chat-admin key; a plain-http web origin, or one equal to the door's, refuses
// boot, and so does a prod server name other than the permanent one.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { schema } from "./config.ts";

const dir = mkdtempSync(join(tmpdir(), "door-config-"));
function file(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o600);
  return path;
}

const DOOR_ENV = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "chat-auth",
  UNSET_COMMIT: "a".repeat(40),
  LISTEN_PORT: "8090",
  PUBLIC_ORIGIN: "https://unset.cc",
  HTTP_ALLOWED_HOSTS: "unset.cc",
  TRUSTED_PROXY_MODE: "socket",
  WEB_ORIGIN: "https://unset.sh",
  PG_HOST: "postgres",
  PG_DATABASE: "unset",
  PG_USER: "chat_auth",
  PG_PASSWORD_FILE: file("pg", "p".repeat(32)),
  PG_SSLMODE: "disable",
  PG_POOL_MAX: "2",
  SEAL_KEYRING_FILE: file(
    "seal",
    JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }),
  ),
  CHAT_ADMIN_URL: "http://chat-admin:8080",
  CHAT_ADMIN_DOOR_KEY_FILE: file("door", "k".repeat(64)),
  CHAT_ADMIN_DOOR_KID: "door-1",
  CHAT_SERVER_NAME: "staging.unset.cc",
  COUNT_LISTEN_PORT: "8091",
  COUNT_ORIGIN: "http://chat-auth:8091",
};

describe("door config", () => {
  test("door_config.boots: with the two origins and the kit's keys", () => {
    const config = loadConfig(schema, DOOR_ENV);
    expect([config.PUBLIC_ORIGIN, config.WEB_ORIGIN]).toEqual(["https://unset.cc", "https://unset.sh"]);
  });

  test("door_config.web_origin: required, https, and never the door's own", () => {
    const { WEB_ORIGIN: _, ...without } = DOOR_ENV;
    expect(() => loadConfig(schema, without)).toThrow();
    expect(() => loadConfig(schema, { ...DOOR_ENV, WEB_ORIGIN: "http://unset.sh" })).toThrow();
    expect(() => loadConfig(schema, { ...DOOR_ENV, WEB_ORIGIN: "https://unset.cc" })).toThrow();
  });

  test("door_config.no_media: the media origin the kit carries for pages is not a door setting", () => {
    expect(Object.keys(schema.fields)).not.toContain("MEDIA_ORIGIN");
  });

  test("door_config.server_name: any host name in dev and test, only the permanent unset.cc in prod", () => {
    expect(loadConfig(schema, DOOR_ENV).CHAT_SERVER_NAME).toBe("staging.unset.cc");
    const problems = (env: Record<string, string>) => {
      try {
        loadConfig(schema, env);
        return [];
      } catch (error) {
        return (error as { problems?: { key: string }[] }).problems?.map((p) => p.key) ?? ["?"];
      }
    };
    expect(problems({ ...DOOR_ENV, UNSET_ENV: "prod" })).toContain("CHAT_SERVER_NAME");
    expect(problems({ ...DOOR_ENV, UNSET_ENV: "prod", CHAT_SERVER_NAME: "unset.cc" })).not.toContain(
      "CHAT_SERVER_NAME",
    );
    expect(problems({ ...DOOR_ENV, CHAT_SERVER_NAME: "not a host" })).toContain("CHAT_SERVER_NAME");
  });

  test("door_config.chat_admin: the door's own key file and kid are required", () => {
    const { CHAT_ADMIN_DOOR_KEY_FILE: _, ...without } = DOOR_ENV;
    expect(() => loadConfig(schema, without)).toThrow();
    expect(() => loadConfig(schema, { ...DOOR_ENV, CHAT_ADMIN_URL: "https://chat-admin" })).toThrow();
  });

  test("door_config.count_port: its own port, never the public one, and a plain-http internal origin", () => {
    expect(loadConfig(schema, DOOR_ENV).COUNT_LISTEN_PORT).toBe(8091);
    expect(() => loadConfig(schema, { ...DOOR_ENV, COUNT_LISTEN_PORT: "8090" })).toThrow();
    const { COUNT_ORIGIN: _, ...without } = DOOR_ENV;
    expect(() => loadConfig(schema, without)).toThrow();
    expect(() => loadConfig(schema, { ...DOOR_ENV, COUNT_ORIGIN: "https://chat-auth:8091" })).toThrow();
  });
});
